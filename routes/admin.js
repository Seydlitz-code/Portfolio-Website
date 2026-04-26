const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

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

// POST /admin/settings - Update site name & bio
router.post('/settings', requireAdmin, (req, res) => {
  const { site_name, bio } = req.body;
  const db = getDb();
  const upsert = db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)');
  if (site_name !== undefined) upsert.run('site_name', site_name.trim());
  if (bio !== undefined) upsert.run('bio', bio.trim());
  res.redirect('/');
});

// POST /admin/profile-image - Upload profile image
router.post('/profile-image', requireAdmin, upload.single('profile_image'), (req, res) => {
  if (!req.file) return res.redirect('/');
  const db = getDb();
  const imgPath = `/uploads/${req.file.filename}`;
  db.prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run('profile_image', imgPath);
  res.redirect('/');
});

// POST /admin/projects - Create project
router.post('/projects', requireAdmin, (req, res) => {
  const { name, name_ja, description } = req.body;
  if (!name || !name.trim()) return res.redirect('/');
  const db = getDb();
  const maxOrder = db.prepare('SELECT MAX(order_num) as m FROM projects').get().m || 0;
  db.prepare(
    'INSERT INTO projects (name, name_ja, description, order_num) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), name_ja ? name_ja.trim() : null, description ? description.trim() : null, maxOrder + 1);
  res.redirect('/');
});

// DELETE /admin/projects/:id - Delete project
router.delete('/projects/:id', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE posts SET project_id = NULL WHERE project_id = ?').run(req.params.id);
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.redirect('/');
});

module.exports = router;
