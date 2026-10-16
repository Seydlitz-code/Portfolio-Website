const express = require('express');
const fs = require('fs');
const bcrypt = require('bcrypt');
const multer = require('multer');
const router = express.Router();
const db = require('../lib/db');
const { asyncRoute } = require('../lib/asyncRoute');
const { createWindowCounter } = require('../lib/security');
const { verifiedMime, IMAGE_MIMES } = require('../lib/fileSniff');

const BCRYPT_ROUNDS = 12;
/* 존재하지 않는 아이디도 같은 비교 비용을 들여 응답 시간으로 계정 존재 여부가 드러나지 않게 함 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('portfolio-dummy-password', BCRYPT_ROUNDS);

/* 로그인 실패: (IP+아이디) 15분 8회, IP 전체 15분 30회 / 가입 성공: IP당 1시간 5회 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFailByAccount = createWindowCounter({ windowMs: LOGIN_WINDOW_MS, max: 8 });
const loginFailByIp = createWindowCounter({ windowMs: LOGIN_WINDOW_MS, max: 30 });
const registerByIp = createWindowCounter({ windowMs: 60 * 60 * 1000, max: 5 });

const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const NICKNAME_MAX = 20;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 20;

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
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

/**
 * 로그인 후 이동 경로: 같은 사이트 내부 경로만 허용.
 * 브라우저는 '\'를 '/'로 바꿔 해석하므로 '/\evil.com'도 '//evil.com'(외부)이 된다 → 차단.
 */
function safeRedirectPath(v) {
  if (typeof v !== 'string' || v.length > 2048) return null;
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(v)) return null;
  return v;
}

function loginAccountKey(req, username) {
  return `${req.ip}|${String(username || '').trim().toLowerCase()}`;
}

/** 세션 고정 방지: 로그인 시 새 세션 ID로 교체한 뒤 사용자 정보 저장 */
function establishLoginSession(req, sessionUser) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenErr) => {
      if (regenErr) return reject(regenErr);
      req.session.user = sessionUser;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
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

router.post(
  '/login',
  asyncRoute(async (req, res) => {
    const { username, password } = req.body;
    const nextForForm = safeRedirectPath(req.body.next) || safeRedirectPath(req.query.next) || null;

    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
      return res.render('login', {
        error: '아이디와 비밀번호를 입력해주세요.',
        success: null,
        next: nextForForm
      });
    }

    const accountKey = loginAccountKey(req, username);
    if (loginFailByAccount.isLimited(accountKey) || loginFailByIp.isLimited(req.ip)) {
      return res.status(429).render('login', {
        error: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요.',
        success: null,
        next: nextForForm
      });
    }

    const user = await db.get('SELECT * FROM users WHERE username = ?', [username.trim()]);
    const passwordOk = await bcrypt.compare(
      password.slice(0, 72),
      user ? user.password : DUMMY_PASSWORD_HASH
    );

    if (!user || !passwordOk) {
      loginFailByAccount.hit(accountKey);
      loginFailByIp.hit(req.ip);
      return res.render('login', {
        error: '아이디 또는 비밀번호가 올바르지 않습니다.',
        success: null,
        next: nextForForm
      });
    }

    loginFailByAccount.reset(accountKey);
    const nextUrl = safeRedirectPath(req.body.next) || safeRedirectPath(req.query.next) || '/';

    const avatar =
      user.avatar != null && String(user.avatar).trim() !== '' ? String(user.avatar).trim() : null;
    try {
      await establishLoginSession(req, {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar,
        is_admin: user.is_admin != null ? Number(user.is_admin) : 0
      });
    } catch (err) {
      console.error('Session save error:', err);
      return res.render('login', {
        error: '로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
        success: null,
        next: nextForForm
      });
    }
    res.redirect(nextUrl);
  })
);

router.get(
  '/check-username',
  asyncRoute(async (req, res) => {
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
    const row = await db.get('SELECT id FROM users WHERE username = ?', [u]);
    if (row) {
      return res.json({ available: false, duplicate: true });
    }
    return res.json({ available: true });
  })
);

router.get(
  '/check-nickname',
  asyncRoute(async (req, res) => {
    const n = (req.query.nickname != null ? String(req.query.nickname) : '').trim();
    if (!n) {
      if (req.session) delete req.session.mypageNicknameVerified;
      return res.json({ available: false, message: '닉네임을 입력해주세요.' });
    }
    if (n.length > 20) {
      if (req.session) delete req.session.mypageNicknameVerified;
      return res.json({ available: false, message: '닉네임은 20자 이하로 입력해주세요.' });
    }
    const row = await db.get('SELECT id FROM users WHERE nickname = ?', [n]);
    const sessUser = req.session && req.session.user;

    function sendJson(payload) {
      if (req.session && typeof req.session.save === 'function') {
        return req.session.save((err) => {
          if (err) return res.status(500).json({ available: false, message: '세션 저장에 실패했습니다.' });
          return res.json(payload);
        });
      }
      return res.json(payload);
    }

    if (row) {
      if (sessUser && Number(row.id) === Number(sessUser.id)) {
        if (req.session) req.session.mypageNicknameVerified = n;
        return sendJson({ available: true, self: true });
      }
      if (req.session) delete req.session.mypageNicknameVerified;
      return res.json({ available: false, duplicate: true });
    }
    if (sessUser && req.session) {
      req.session.mypageNicknameVerified = n;
    }
    return sendJson({ available: true });
  })
);

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  const captcha = generateCaptcha();
  req.session.captchaAnswer = captcha.answer;
  res.render('register', { error: null, captchaQuestion: captcha.question });
});

router.post(
  '/register',
  (req, res, next) => {
    uploadAvatar.single('avatar')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return registerFail(req, res, '프로필 이미지는 3MB 이하여야 합니다.');
        }
        return registerFail(req, res, err.message || '이미지 업로드에 실패했습니다.');
      }
      next();
    });
  },
  asyncRoute(async (req, res) => {
    const fail = (msg) => registerFail(req, res, msg);

    const str = (v) => (typeof v === 'string' ? v : '');
    const nickname = str(req.body.nickname).trim();
    const username = str(req.body.username).trim();
    const password = str(req.body.password);
    const passwordConfirm = str(req.body.passwordConfirm);
    const captcha = str(req.body.captcha).trim();

    if (registerByIp.isLimited(req.ip)) {
      return fail('짧은 시간에 너무 많은 가입이 시도되었습니다. 잠시 후 다시 시도해주세요.');
    }
    if (!nickname || !username || !password || !passwordConfirm || !captcha) {
      return fail('모든 항목을 입력해주세요.');
    }
    /* 캡차 정답은 1회용: 확인 즉시 폐기해 같은 답으로 반복 가입하지 못하게 함 */
    const expectedCaptcha = req.session.captchaAnswer;
    delete req.session.captchaAnswer;
    if (expectedCaptcha == null || parseInt(captcha, 10) !== expectedCaptcha) {
      return fail('보안 문자가 올바르지 않습니다. 다시 시도해주세요.');
    }
    if (password !== passwordConfirm) {
      return fail('비밀번호가 일치하지 않습니다.');
    }
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      return fail(`비밀번호는 ${PASSWORD_MIN}자 이상 ${PASSWORD_MAX}자 이하여야 합니다.`);
    }
    if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
      return fail(`아이디는 ${USERNAME_MIN}자 이상 ${USERNAME_MAX}자 이하여야 합니다.`);
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return fail('아이디는 영문, 숫자, 밑줄(_)만 사용할 수 있습니다.');
    }
    if (Array.from(nickname).length > NICKNAME_MAX) {
      return fail(`닉네임은 ${NICKNAME_MAX}자 이하로 입력해주세요.`);
    }

    const existingUser = await db.get('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return fail('이미 사용 중인 아이디입니다.');
    }
    const existingNick = await db.get('SELECT id FROM users WHERE nickname = ?', [nickname]);
    if (existingNick) {
      return fail('이미 사용 중인 닉네임입니다.');
    }

    let avatarMime = null;
    let avatarBuf = null;
    if (req.file && req.file.buffer && req.file.buffer.length) {
      avatarMime = verifiedMime(req.file.buffer, IMAGE_MIMES);
      if (!avatarMime) {
        return fail('프로필 이미지는 JPG, PNG, GIF, WEBP만 가능합니다.');
      }
      avatarBuf = req.file.buffer;
    }

    try {
      const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const ins = await db.run('INSERT INTO users (username, nickname, password, avatar) VALUES (?, ?, ?, ?)', [
        username,
        nickname,
        hashed,
        null
      ]);
      registerByIp.hit(req.ip);
      const newId = ins.lastInsertRowid;
      if (avatarBuf && newId != null) {
        const mediaPath = `/media/user/${newId}/avatar`;
        await db.run('UPDATE users SET avatar = ?, avatar_mime = ?, avatar_blob = ? WHERE id = ?', [
          mediaPath,
          avatarMime,
          avatarBuf,
          newId
        ]);
      }
      res.redirect('/auth/login?registered=true');
    } catch (err) {
      console.error(err);
      return fail('회원가입 중 오류가 발생했습니다. 다시 시도해주세요.');
    }
  })
);

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

module.exports = router;
