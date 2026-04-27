const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../config/database');
const { getSiteHomeData } = require('../lib/siteData');
const { requireAdmin } = require('../middleware/auth');
const multer = require('multer');

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

// GET /admin/mypage — 관리자 편집 화면
router.get('/mypage', requireAdmin, (req, res) => {
  res.render('mypage', {
    ...getSiteHomeData(),
    mypageActive: true,
    saved: req.query.saved === '1',
    errMessage: null
  });
});

// POST /admin/apply — 프로필·이름·소개 한 번에 반영(적용하기)
router.post(
  '/apply',
  requireAdmin,
  (req, res, next) => {
    upload.single('profile_image')(req, res, (err) => {
      if (err) {
        return res.status(400).render('mypage', {
          ...getSiteHomeData(),
          mypageActive: true,
          saved: false,
          errMessage: err.message || '이미지 업로드에 실패했습니다.'
        });
      }
      next();
    });
  },
  (req, res) => {
    const { site_name, bio } = req.body;
    const db = getDb();
    const upsert = db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)');
    if (site_name !== undefined) {
      const v = (site_name + '').trim();
      upsert.run('site_name', v);
    }
    if (bio !== undefined) {
      upsert.run('bio', (bio + '').trim());
    }
    if (req.file) {
      const imgPath = `/uploads/${req.file.filename}`;
      db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run('profile_image', imgPath);
    }
    res.redirect('/admin/mypage?saved=1');
  }
);

// POST /admin/settings — (호환) 마이페이지로 유도
router.post('/settings', requireAdmin, (req, res) => {
  const { site_name, bio } = req.body;
  const db = getDb();
  const upsert = db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)');
  if (site_name !== undefined) upsert.run('site_name', (site_name + '').trim());
  if (bio !== undefined) upsert.run('bio', (bio + '').trim());
  res.redirect('/admin/mypage?saved=1');
});

// POST /admin/profile-image — (호환) 단일 이미지 업로드
router.post('/profile-image', requireAdmin, (req, res) => {
  upload.single('profile_image')(req, res, (err) => {
    if (err) {
      return res.status(400).send(err.message || '업로드 오류');
    }
    if (!req.file) return res.redirect('/admin/mypage');
    const db = getDb();
    const imgPath = `/uploads/${req.file.filename}`;
    db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run('profile_image', imgPath);
    res.redirect('/admin/mypage?saved=1');
  });
});

// POST /admin/projects
router.post('/projects', requireAdmin, (req, res) => {
  const { name, name_ja, description } = req.body;
  if (!name || !name.trim()) return res.redirect('/admin/mypage');
  const db = getDb();
  const maxOrder = db.prepare('SELECT MAX(order_num) as m FROM projects').get().m || 0;
  db.prepare(
    'INSERT INTO projects (name, name_ja, description, order_num) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), name_ja ? name_ja.trim() : null, description ? description.trim() : null, maxOrder + 1);
  res.redirect('/admin/mypage?saved=1');
});

// DELETE /admin/projects/:id
router.delete('/projects/:id', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE posts SET project_id = NULL WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.redirect('/admin/mypage?saved=1');
});

module.exports = router;
