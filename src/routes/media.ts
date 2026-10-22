/** 이미지·동영상 제공 (기존 routes/media.js 이식). 파일은 R2에 있다. */
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { parseId } from '../lib/ids';
import { IMAGE_MIMES, MEDIA_MIMES } from '../lib/fileSniff';
import { KIND_SITE_PROFILE_IMAGE } from '../lib/siteData';

const DEFAULT_AVATAR = '/images/default-profile.svg';

/** 메인 프로필 이미지 브라우저 캐시: 1시간 (바꾸면 주소는 같으므로 너무 길게 두지 않음) */
const SITE_IMAGE_CACHE_SEC = 60 * 60;
/** 아바타 브라우저 캐시: 5분 (바꿔도 주소가 같아 짧게, 이후에는 304로 확인만 함) */
const AVATAR_CACHE_SEC = 5 * 60;
/** 본문 첨부 브라우저 캐시: 1일 (첨부는 id마다 내용이 바뀌지 않음) */
const POST_BODY_CACHE_SEC = 24 * 60 * 60;

const media = new Hono<AppEnv>();

/** 저장된 MIME이 허용 목록에 없으면 다운로드용 타입으로만 제공 */
function resolveSafeMime(mime: string | null | undefined, allowed: readonly string[]): string {
  const normalized = String(mime || '').toLowerCase();
  return allowed.includes(normalized) ? normalized : 'application/octet-stream';
}

/**
 * 'bytes=start-end' 단일 범위 → { start, end } (end 포함).
 * 범위를 만족할 수 없으면 'unsatisfiable', 헤더가 없거나 형식 밖이면 null.
 */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText, endText] = match;
  if (startText === '' && endText === '') return null;
  let start: number;
  let end: number;
  if (startText === '') {
    // 'bytes=-500': 끝에서 500바이트
    const suffix = Number(endText);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

const respondNotFound = () => new Response('Not found', { status: 404 });

/**
 * R2 이미지를 조건부로 읽어 응답한다. 브라우저가 보낸 If-None-Match가 현재 ETag와 같으면
 * R2가 본문 없이 메타데이터만 주므로 304로 답한다 (전송량·R2 읽기 비용 절약).
 * 파일이 없으면 null.
 */
async function serveR2Image(
  bucket: R2Bucket,
  request: Request,
  key: string,
  mime: string | null | undefined,
  cacheControl: string
): Promise<Response | null> {
  const object = await bucket.get(key, { onlyIf: request.headers });
  if (!object) return null;
  const headers = {
    'Content-Type': resolveSafeMime(mime ?? object.httpMetadata?.contentType, IMAGE_MIMES),
    'Cache-Control': cacheControl,
    ETag: object.httpEtag
  };
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
}

media.get('/site/profile-image', async (c) => {
  const row = await c.env.DB.prepare('SELECT r2_key, mime FROM site_assets WHERE kind = ?')
    .bind(KIND_SITE_PROFILE_IMAGE)
    .first<{ r2_key: string; mime: string }>();
  if (!row) return respondNotFound();
  return (await serveR2Image(c.env.MEDIA, c.req.raw, row.r2_key, row.mime, `public, max-age=${SITE_IMAGE_CACHE_SEC}`)) ?? respondNotFound();
});

/** 프로필 이미지. 없으면 기본 이미지로 보낸다. */
media.get('/user/:id/avatar', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id == null) return respondNotFound();
  const row = await c.env.DB.prepare('SELECT avatar_key FROM users WHERE id = ?')
    .bind(id)
    .first<{ avatar_key: string | null }>();
  if (!row) return respondNotFound();
  if (!row.avatar_key) return c.redirect(DEFAULT_AVATAR);
  const res = await serveR2Image(c.env.MEDIA, c.req.raw, row.avatar_key, null, `public, max-age=${AVATAR_CACHE_SEC}`);
  return res ?? c.redirect(DEFAULT_AVATAR);
});

/**
 * 게시물 본문 첨부. 동영상은 HTTP Range(206)를 지원해야 iOS Safari 등에서 재생·탐색이 된다.
 * 요청한 범위만 R2에서 읽어 그대로 흘려보낸다.
 */
media.get('/post-body/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id == null) return respondNotFound();
  const meta = await c.env.DB.prepare('SELECT r2_key, mime, size FROM post_body_assets WHERE id = ?')
    .bind(id)
    .first<{ r2_key: string; mime: string; size: number }>();
  if (!meta || !meta.size) return respondNotFound();

  const size = Number(meta.size);
  const etag = `"pb-${id}-${size}"`;
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': `public, max-age=${POST_BODY_CACHE_SEC}`,
    ETag: etag,
    'Content-Type': resolveSafeMime(meta.mime, MEDIA_MIMES)
  });

  const range = parseRange(c.req.header('range'), size);
  const ifRange = c.req.header('if-range');
  const isRangeApplicable = range && (!ifRange || ifRange === etag);

  if (!isRangeApplicable && c.req.header('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  if (isRangeApplicable && range) {
    const length = range.end - range.start + 1;
    const object = await c.env.MEDIA.get(meta.r2_key, { range: { offset: range.start, length } });
    if (!object) return respondNotFound();
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }

  const object = await c.env.MEDIA.get(meta.r2_key);
  if (!object) return respondNotFound();
  headers.set('Content-Length', String(size));
  return new Response(object.body, { headers });
});

export default media;
