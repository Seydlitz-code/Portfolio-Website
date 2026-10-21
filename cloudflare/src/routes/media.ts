/** 이미지·동영상 제공 (기존 routes/media.js 이식). 파일은 R2에 있다. */
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { parseId } from '../lib/ids';
import { IMAGE_MIMES, VIDEO_MIMES } from '../lib/fileSniff';
import { KIND_SITE_PROFILE_IMAGE } from '../lib/siteData';

const DEFAULT_AVATAR = '/images/default-profile.svg';
const MEDIA_MIMES: readonly string[] = [...IMAGE_MIMES, ...VIDEO_MIMES];

const media = new Hono<AppEnv>();

/** 저장된 MIME이 허용 목록에 없으면 다운로드용 타입으로만 제공 */
function safeMime(mime: string | null | undefined, allowed: readonly string[]): string {
  const m = String(mime || '').toLowerCase();
  return allowed.includes(m) ? m : 'application/octet-stream';
}

/**
 * 'bytes=start-end' 단일 범위 → { start, end } (end 포함).
 * 범위를 만족할 수 없으면 'unsatisfiable', 헤더가 없거나 형식 밖이면 null.
 */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

const notFound = () => new Response('Not found', { status: 404 });

media.get('/site/profile-image', async (c) => {
  const row = await c.env.DB.prepare('SELECT r2_key, mime FROM site_assets WHERE kind = ?')
    .bind(KIND_SITE_PROFILE_IMAGE)
    .first<{ r2_key: string; mime: string }>();
  const obj = row ? await c.env.MEDIA.get(row.r2_key) : null;
  if (!row || !obj) return notFound();
  return new Response(obj.body, {
    headers: {
      'Content-Type': safeMime(row.mime, IMAGE_MIMES),
      'Cache-Control': 'public, max-age=3600',
      ETag: obj.httpEtag
    }
  });
});

/** 프로필 이미지. 없으면 기본 이미지로 보낸다. */
media.get('/user/:id/avatar', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id == null) return notFound();
  const row = await c.env.DB.prepare('SELECT avatar_key FROM users WHERE id = ?')
    .bind(id)
    .first<{ avatar_key: string | null }>();
  if (!row?.avatar_key) return c.redirect(DEFAULT_AVATAR);
  const obj = await c.env.MEDIA.get(row.avatar_key);
  if (!obj) return c.redirect(DEFAULT_AVATAR);
  return new Response(obj.body, {
    headers: {
      'Content-Type': safeMime(obj.httpMetadata?.contentType, IMAGE_MIMES),
      // 아바타를 바꾸면 R2 키가 바뀌지만 주소는 같으므로 짧게 캐시한다.
      'Cache-Control': 'public, max-age=300',
      ETag: obj.httpEtag
    }
  });
});

/**
 * 게시물 본문 첨부. 동영상은 HTTP Range(206)를 지원해야 iOS Safari 등에서 재생·탐색이 된다.
 * 요청한 범위만 R2에서 읽어 그대로 흘려보낸다.
 */
media.get('/post-body/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id == null) return notFound();
  const meta = await c.env.DB.prepare('SELECT r2_key, mime, size FROM post_body_assets WHERE id = ?')
    .bind(id)
    .first<{ r2_key: string; mime: string; size: number }>();
  if (!meta || !meta.size) return notFound();

  const size = Number(meta.size);
  const etag = `"pb-${id}-${size}"`;
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
    ETag: etag,
    'Content-Type': safeMime(meta.mime, MEDIA_MIMES)
  });

  const range = parseRange(c.req.header('range'), size);
  const ifRange = c.req.header('if-range');
  const rangeApplies = range && (!ifRange || ifRange === etag);

  if (!rangeApplies && c.req.header('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  if (rangeApplies && range) {
    const length = range.end - range.start + 1;
    const obj = await c.env.MEDIA.get(meta.r2_key, { range: { offset: range.start, length } });
    if (!obj) return notFound();
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
    headers.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }

  const obj = await c.env.MEDIA.get(meta.r2_key);
  if (!obj) return notFound();
  headers.set('Content-Length', String(size));
  return new Response(obj.body, { headers });
});

export default media;
