const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../lib/db');
const { getSiteHomeData } = require('../lib/siteData');
const { getAccountShell } = require('../lib/mypageShell');
const { requireAdmin } = require('../middleware/auth');
const multer = require('multer');
const { asyncRoute } = require('../lib/asyncRoute');

const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../public/uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `profile-${Date.now()}${ext}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('이미지 파일(JPG, PNG, GIF, WEBP)만 업로드 가능합니다.'));
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

function runUploadSingle(field) {
  return (req, res) =>
    new Promise((resolve, reject) => {
      upload.single(field)(req, res, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
}

router.get('/mypage', requireAdmin, (req, res) => {
  res.redirect(302, '/mypage/main-settings');
});

router.post(
  '/apply',
  requireAdmin,
  asyncRoute(async (req, res) => {
    try {
      await runUploadSingle('profile_image')(req, res);
    } catch (err) {
      const shell = await getAccountShell(req);
      if (!shell) return res.status(400).send(err.message || '업로드 오류');
      const home = await getSiteHomeData();
      return res.status(400).render('mypage-account', {
        ...shell,
        ...home,
        activeTab: 'mainSettings',
        saved: false,
        errMessage: err.message || '이미지 업로드에 실패했습니다.'
      });
    }

    const { site_name, bio } = req.body;
    if (site_name !== undefined) {
      const v = (site_name + '').trim();
      await db.upsertSiteSetting('site_name', v);
    }
    if (bio !== undefined) {
      await db.upsertSiteSetting('bio', (bio + '').trim());
    }
    if (req.file) {
      const imgPath = `/uploads/${req.file.filename}`;
      await db.upsertSiteSetting('profile_image', imgPath);
    }
    res.redirect('/mypage/main-settings?saved=1');
  })
);

router.post(
  '/settings',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const { site_name, bio } = req.body;
    if (site_name !== undefined) await db.upsertSiteSetting('site_name', (site_name + '').trim());
    if (bio !== undefined) await db.upsertSiteSetting('bio', (bio + '').trim());
    res.redirect('/mypage/main-settings?saved=1');
  })
);

router.post(
  '/profile-image',
  requireAdmin,
  asyncRoute(async (req, res) => {
    try {
      await runUploadSingle('profile_image')(req, res);
    } catch (err) {
      return res.status(400).send(err.message || '업로드 오류');
    }
    if (!req.file) return res.redirect('/mypage/main-settings');
    const imgPath = `/uploads/${req.file.filename}`;
    await db.upsertSiteSetting('profile_image', imgPath);
    res.redirect('/mypage/main-settings?saved=1');
  })
);

router.post(
  '/projects',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const name = (req.body.name != null ? String(req.body.name) : '').trim();
    const nameJa = (req.body.name_ja != null ? String(req.body.name_ja) : '').trim();
    const description = (req.body.description != null ? String(req.body.description) : '').trim();
    if (!name || !nameJa || !description) {
      return res.redirect('/mypage/boards?createErr=1');
    }
    const maxRow = await db.get('SELECT MAX(order_num) as m FROM projects');
    const maxOrder = maxRow && maxRow.m != null ? Number(maxRow.m) : 0;
    await db.run('INSERT INTO projects (name, name_ja, description, order_num) VALUES (?, ?, ?, ?)', [
      name,
      nameJa,
      description,
      maxOrder + 1
    ]);
    res.redirect('/mypage/boards?saved=1');
  })
);

router.delete(
  '/projects/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = req.params.id;
    const row = await db.get('SELECT COUNT(*) as c FROM posts WHERE project_id = ?', [id]);
    const cnt = row && row.c != null ? Number(row.c) : 0;
    if (cnt > 0) {
      return res.redirect('/mypage/boards?deleteBlocked=1');
    }
    await db.run('DELETE FROM projects WHERE id = ?', [id]);
    res.redirect('/mypage/boards?deleted=1');
  })
);

module.exports = router;
