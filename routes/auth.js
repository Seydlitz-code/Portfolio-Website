const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const multer = require('multer');
const router = express.Router();
const { getDb } = require('../config/database');

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads/avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.png';
    cb(null, `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safe}`);
  }
});

const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('프로필 이미지는 JPG, PNG, GIF, WEBP만 가능합니다.'));
  },
  limits: { fileSize: 3 * 1024 * 1024 }
});

function generateCaptcha() {
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  return { question: `${a} + ${b} = ?`, answer: a + b };
}

function safeRedirectPath(v) {
  if (typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//')) return null;
  return v;
}

function rollCaptcha(req) {
  const c = generateCaptcha();
  req.session.captchaAnswer = c.answer;
  return c.question;
}

function registerFail(req, res, msg) {
  const question = rollCaptcha(req);
  if (req.file && req.file.path) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      /* ignore */
    }
  }
  if (req.get('X-Register-Fetch') === '1') {
    return res.status(400).json({ error: msg, captchaQuestion: question });
  }
  return res.render('register', { error: msg, captchaQuestion: question });
}

// GET /auth/login
router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(safeRedirectPath(req.query.next) || '/');
  }
  const registered = req.query.registered === 'true';
  const next = safeRedirectPath(req.query.next);
  res.render('login', {
    error: null,
    success: registered ? '회원가입이 완료되었습니다. 로그인해주세요.' : null,
    next: next
  });
});

// POST /auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const nextForForm = safeRedirectPath(req.body.next) || safeRedirectPath(req.query.next) || null;

  if (!username || !password) {
    return res.render('login', { error: '아이디와 비밀번호를 입력해주세요.', success: null, next: nextForForm });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: '아이디 또는 비밀번호가 올바르지 않습니다.', success: null, next: nextForForm });
  }

  // connect-sqlite3(비동기) 세션이 파일에 쓰이기 전에 redirect 하면
  // 쿠키/세션이 반영되지 않은 것처럼 보일 수 있으므로 반드시 save 후 응답
  const nextUrl = safeRedirectPath(req.body.next) || safeRedirectPath(req.query.next) || '/';

  const avatar =
    user.avatar != null && String(user.avatar).trim() !== '' ? String(user.avatar).trim() : null;
  req.session.user = {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    avatar,
    is_admin: user.is_admin != null ? Number(user.is_admin) : 0
  };

  req.session.save((err) => {
    if (err) {
      console.error('Session save error:', err);
      return res.render('login', {
        error: '로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        success: null,
        next: nextForForm
      });
    }
    res.redirect(nextUrl);
  });
});

// GET /auth/check-username (JSON)
router.get('/check-username', (req, res) => {
  const u = (req.query.username != null ? String(req.query.username) : '').trim();
  if (!u) {
    return res.json({ available: false, message: '아이디를 입력해주세요.' });
  }
  if (u.length < 3) {
    return res.json({ available: false, message: '아이디는 3자 이상이어야 합니다.' });
  }
  if (u.length > 30) {
    return res.json({ available: false, message: '아이디가 너무 깁니다.' });
  }
  if (!/^[a-zA-Z0-9_]+$/.test(u)) {
    return res.json({ available: false, message: '영문, 숫자, 밑줄(_)만 사용할 수 있습니다.' });
  }
  const row = getDb().prepare('SELECT id FROM users WHERE username = ?').get(u);
  if (row) {
    return res.json({ available: false, duplicate: true });
  }
  return res.json({ available: true });
});

// GET /auth/check-nickname (JSON)
router.get('/check-nickname', (req, res) => {
  const n = (req.query.nickname != null ? String(req.query.nickname) : '').trim();
  if (!n) {
    return res.json({ available: false, message: '닉네임을 입력해주세요.' });
  }
  if (n.length > 20) {
    return res.json({ available: false, message: '닉네임은 20자 이하로 입력해주세요.' });
  }
  const row = getDb().prepare('SELECT id FROM users WHERE nickname = ?').get(n);
  if (row) {
    return res.json({ available: false, duplicate: true });
  }
  return res.json({ available: true });
});

// GET /auth/register
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  const captcha = generateCaptcha();
  req.session.captchaAnswer = captcha.answer;
  res.render('register', { error: null, captchaQuestion: captcha.question });
});

// POST /auth/register
router.post('/register', (req, res, next) => {
  uploadAvatar.single('avatar')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return registerFail(req, res, '프로필 이미지는 3MB 이하여야 합니다.');
      }
      return registerFail(req, res, err.message || '이미지 업로드에 실패했습니다.');
    }
    next();
  });
}, (req, res) => {
  const { nickname, username, password, passwordConfirm, captcha } = req.body;

  const fail = (msg) => registerFail(req, res, msg);

  if (!nickname || !username || !password || !passwordConfirm || !captcha) {
    return fail('모든 항목을 입력해주세요.');
  }
  if (parseInt(captcha, 10) !== req.session.captchaAnswer) {
    return fail('보안 문자가 올바르지 않습니다. 다시 시도해주세요.');
  }
  if (password !== passwordConfirm) {
    return fail('비밀번호가 일치하지 않습니다.');
  }
  if (password.length < 8) {
    return fail('비밀번호는 8자 이상이어야 합니다.');
  }
  if (username.length < 3) {
    return fail('아이디는 3자 이상이어야 합니다.');
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return fail('아이디는 영문, 숫자, 밑줄(_)만 사용할 수 있습니다.');
  }

  const db = getDb();
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existingUser) {
    return fail('이미 사용 중인 아이디입니다.');
  }
  const existingNick = db.prepare('SELECT id FROM users WHERE nickname = ?').get(nickname.trim());
  if (existingNick) {
    return fail('이미 사용 중인 닉네임입니다.');
  }

  let avatarPath = null;
  if (req.file) {
    avatarPath = `/uploads/avatars/${req.file.filename}`;
  }

  try {
    const hashed = bcrypt.hashSync(password, 12);
    db.prepare(
      'INSERT INTO users (username, nickname, password, avatar) VALUES (?, ?, ?, ?)'
    ).run(username.trim(), nickname.trim(), hashed, avatarPath);
    res.redirect('/auth/login?registered=true');
  } catch (err) {
    console.error(err);
    return fail('회원가입 중 오류가 발생했습니다. 다시 시도해주세요.');
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
