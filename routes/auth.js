const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const { getDb } = require('../db/database');

function generateCaptcha() {
  const a = Math.floor(Math.random() * 10) + 1;
  const b = Math.floor(Math.random() * 10) + 1;
  return { question: `${a} + ${b} = ?`, answer: a + b };
}

function safeRedirectPath(v) {
  if (typeof v !== 'string' || !v.startsWith('/') || v.startsWith('//')) return null;
  return v;
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

  req.session.user = {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
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

// GET /auth/register
router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  const captcha = generateCaptcha();
  req.session.captchaAnswer = captcha.answer;
  res.render('register', { error: null, captchaQuestion: captcha.question });
});

// POST /auth/register
router.post('/register', (req, res) => {
  const { nickname, username, password, passwordConfirm, captcha } = req.body;

  const newCaptcha = () => {
    const c = generateCaptcha();
    req.session.captchaAnswer = c.answer;
    return c.question;
  };

  const fail = (msg) => {
    return res.render('register', { error: msg, captchaQuestion: newCaptcha() });
  };

  if (!nickname || !username || !password || !passwordConfirm || !captcha) {
    return fail('모든 항목을 입력해주세요.');
  }
  if (parseInt(captcha) !== req.session.captchaAnswer) {
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
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existing) {
    return fail('이미 사용 중인 아이디입니다.');
  }

  try {
    const hashed = bcrypt.hashSync(password, 12);
    db.prepare(
      'INSERT INTO users (username, nickname, password) VALUES (?, ?, ?)'
    ).run(username.trim(), nickname.trim(), hashed);
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
