const express = require('express');
const db = require('../lib/db');
const { getPersistedBinary, KIND_SITE_PROFILE_IMAGE } = require('../lib/binaryAssets');
const { asyncRoute } = require('../lib/asyncRoute');

const router = express.Router();

function asBuffer(data) {
  if (data == null) return null;
  if (Buffer.isBuffer(data)) return data.length ? data : null;
  if (data instanceof Uint8Array) return data.length ? Buffer.from(data) : null;
  return null;
}

router.get(
  '/site/profile-image',
  asyncRoute(async (req, res) => {
    const row = await getPersistedBinary(KIND_SITE_PROFILE_IMAGE);
    const buf = row ? asBuffer(row.data) : null;
    if (!buf) return res.status(404).send('Not found');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.type(row.mime || 'image/jpeg').send(buf);
  })
);

router.get(
  '/user/:id/avatar',
  asyncRoute(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id) || id < 1) return res.status(404).send('Not found');

    const row = await db.get(
      'SELECT avatar_mime, avatar_blob, avatar FROM users WHERE id = ?',
      [id]
    );
    if (!row) return res.status(404).send('Not found');

    const buf = asBuffer(row.avatar_blob);
    if (buf) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.type(row.avatar_mime || 'image/jpeg').send(buf);
      return;
    }

    const av = row.avatar != null && String(row.avatar).trim() !== '' ? String(row.avatar).trim() : '';
    if (av.startsWith('/') && !av.startsWith('//')) {
      return res.redirect(302, av);
    }
    return res.status(404).send('Not found');
  })
);

module.exports = router;
