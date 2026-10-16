const express = require('express');
const db = require('../lib/db');
const { getPersistedBinary, KIND_SITE_PROFILE_IMAGE } = require('../lib/binaryAssets');
const { asyncRoute } = require('../lib/asyncRoute');
const { parseId } = require('../lib/ids');
const { IMAGE_MIMES, VIDEO_MIMES } = require('../lib/fileSniff');

const router = express.Router();

/* 한 번의 Range 응답 최대 크기: 큰 동영상도 요청마다 전체를 메모리에 올리지 않도록 */
const MAX_RANGE_CHUNK = 4 * 1024 * 1024;

function asBuffer(data) {
  if (data == null) return null;
  if (Buffer.isBuffer(data)) return data.length ? data : null;
  if (data instanceof Uint8Array) return data.length ? Buffer.from(data) : null;
  return null;
}

/** DB에 저장된 MIME이 허용 목록에 없으면 다운로드용 타입으로만 서빙 */
function safeMime(mime, allowed) {
  const m = String(mime || '').toLowerCase();
  return allowed.includes(m) ? m : 'application/octet-stream';
}

/**
 * 'bytes=start-end' 단일 범위 파싱 → { start, end } (end 포함), 범위 불가면 'unsatisfiable', 헤더 없거나 형식 외면 null
 */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
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
  end = Math.min(end, start + MAX_RANGE_CHUNK - 1);
  return { start, end };
}

router.get(
  '/site/profile-image',
  asyncRoute(async (req, res) => {
    const row = await getPersistedBinary(KIND_SITE_PROFILE_IMAGE);
    const buf = row ? asBuffer(row.data) : null;
    if (!buf) return res.status(404).send('Not found');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type(safeMime(row.mime, IMAGE_MIMES)).send(buf);
  })
);

router.get(
  '/user/:id/avatar',
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    if (id == null) return res.status(404).send('Not found');

    const row = await db.get(
      'SELECT avatar_mime, avatar_blob, avatar FROM users WHERE id = ?',
      [id]
    );
    if (!row) return res.status(404).send('Not found');

    const buf = asBuffer(row.avatar_blob);
    if (buf) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.type(safeMime(row.avatar_mime, IMAGE_MIMES)).send(buf);
      return;
    }

    const av = row.avatar != null && String(row.avatar).trim() !== '' ? String(row.avatar).trim() : '';
    if (av.startsWith('/') && !av.startsWith('//') && !av.includes('\\')) {
      return res.redirect(302, av);
    }
    return res.status(404).send('Not found');
  })
);

/**
 * 게시물 본문 첨부. 동영상은 HTTP Range(206)를 지원해야 iOS Safari 등에서 재생·탐색이 된다.
 * 요청 범위만 DB에서 substr로 잘라 읽는다 (SQLite BLOB / PostgreSQL bytea 공통, 1부터 시작).
 */
router.get(
  '/post-body/:id',
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id);
    if (id == null) return res.status(404).send('Not found');
    const meta = await db.get('SELECT mime, length(data) AS size FROM post_body_assets WHERE id = ?', [id]);
    const size = meta ? Number(meta.size) : 0;
    if (!meta || !size) return res.status(404).send('Not found');

    const etag = `"pb-${id}-${size}"`;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('ETag', etag);
    res.type(safeMime(meta.mime, IMAGE_MIMES.concat(VIDEO_MIMES)));

    const range = parseRange(req.get('range'), size);
    const ifRange = req.get('if-range');
    const rangeApplies = range && (!ifRange || ifRange === etag);

    if (!rangeApplies && req.get('if-none-match') === etag) {
      return res.status(304).end();
    }
    if (range === 'unsatisfiable') {
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    }

    if (rangeApplies) {
      const len = range.end - range.start + 1;
      const part = await db.get('SELECT substr(data, ?, ?) AS chunk FROM post_body_assets WHERE id = ?', [
        range.start + 1,
        len,
        id
      ]);
      const buf = part ? asBuffer(part.chunk) : null;
      if (!buf) return res.status(404).send('Not found');
      res.status(206);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.start + buf.length - 1}/${size}`);
      return res.send(buf);
    }

    const row = await db.get('SELECT data FROM post_body_assets WHERE id = ?', [id]);
    const buf = row ? asBuffer(row.data) : null;
    if (!buf) return res.status(404).send('Not found');
    res.send(buf);
  })
);

module.exports = router;
