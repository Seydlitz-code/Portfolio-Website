import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { LoginPage, RegisterPage } from '../views/auth';
import { hashPassword, verifyPassword } from '../lib/password';
import { endSession, startSession } from '../lib/session';
import { checkCaptcha, issueCaptcha } from '../lib/captcha';
import { clientIp, safeRedirectPath } from '../lib/security';
import { IMAGE_MIMES, verifiedMime } from '../lib/fileSniff';
import * as rate from '../lib/rateLimit';
import { forgetVerifiedNickname, rememberVerifiedNickname } from '../lib/nicknameCheck';

const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const NICKNAME_MAX = 20;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 20;
/** 로그인 비밀번호 입력 상한 (해시 계산 전에 너무 긴 입력을 거른다) */
const LOGIN_PASSWORD_MAX = 128;
const AVATAR_MAX_BYTES = 3 * 1024 * 1024;
/** multipart 전체 크기 상한: 아바타 3MB + 다른 필드 여유분 */
const REGISTER_BODY_MAX_BYTES = 4 * 1024 * 1024;
const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

const auth = new Hono<AppEnv>();

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function loginAccountKey(c: Context<AppEnv>, username: string) {
  return `${clientIp(c)}|${username.trim().toLowerCase()}`;
}

/* ---------- 로그인 ---------- */

auth.get('/login', (c) => {
  const next = safeRedirectPath(c.req.query('next'));
  if (c.get('user')) return c.redirect(next || '/');
  const success = c.req.query('registered') === 'true' ? '회원가입이 완료되었습니다. 로그인해주세요.' : null;
  return c.html(<LoginPage error={null} success={success} next={next} />);
});

auth.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const username = str(body.username).trim();
  const password = str(body.password);
  const nextForForm = safeRedirectPath(body.next) || safeRedirectPath(c.req.query('next'));
  const fail = (error: string, status: 200 | 429 = 200) =>
    c.html(<LoginPage error={error} success={null} next={nextForForm} />, status);

  if (!username || !password) return fail('아이디와 비밀번호를 입력해주세요.');

  const db = c.env.DB;
  const ip = clientIp(c);
  const accountKey = loginAccountKey(c, username);
  if (
    (await rate.isLimited(db, rate.LOGIN_FAIL_BY_ACCOUNT, accountKey)) ||
    (await rate.isLimited(db, rate.LOGIN_FAIL_BY_IP, ip))
  ) {
    return fail('로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요.', 429);
  }

  const user = await db
    .prepare('SELECT id, password_hash FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: number; password_hash: string }>();
  const passwordOk =
    password.length <= LOGIN_PASSWORD_MAX && (await verifyPassword(password, user ? user.password_hash : null));

  if (!user || !passwordOk) {
    await rate.hit(db, rate.LOGIN_FAIL_BY_ACCOUNT, accountKey);
    await rate.hit(db, rate.LOGIN_FAIL_BY_IP, ip);
    return fail('아이디 또는 비밀번호가 올바르지 않습니다.');
  }

  await rate.reset(db, rate.LOGIN_FAIL_BY_ACCOUNT, accountKey);
  await startSession(c, user.id);
  return c.redirect(nextForForm || '/');
});

auth.post('/logout', async (c) => {
  await endSession(c);
  return c.redirect('/');
});

/* ---------- 중복 확인 (register.js가 호출) ---------- */

auth.get('/check-username', async (c) => {
  const u = str(c.req.query('username')).trim();
  if (!u) return c.json({ available: false, message: '아이디를 입력해주세요.' });
  if (u.length < USERNAME_MIN) return c.json({ available: false, message: '아이디는 3자 이상이어야 합니다.' });
  if (u.length > USERNAME_MAX) return c.json({ available: false, message: '아이디가 너무 깁니다.' });
  if (!USERNAME_PATTERN.test(u)) {
    return c.json({ available: false, message: '영문, 숫자, 밑줄(_)만 사용할 수 있습니다.' });
  }
  const row = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(u).first();
  return c.json(row ? { available: false, duplicate: true } : { available: true });
});

/** 로그인한 상태에서 통과하면 마이페이지 닉네임 변경에 쓸 수 있도록 확인 결과를 기억한다. */
auth.get('/check-nickname', async (c) => {
  const n = str(c.req.query('nickname')).trim();
  const me = c.get('user');
  if (!n) {
    forgetVerifiedNickname(c);
    return c.json({ available: false, message: '닉네임을 입력해주세요.' });
  }
  if (Array.from(n).length > NICKNAME_MAX) {
    forgetVerifiedNickname(c);
    return c.json({ available: false, message: '닉네임은 20자 이하로 입력해주세요.' });
  }
  const row = await c.env.DB.prepare('SELECT id FROM users WHERE nickname = ?').bind(n).first<{ id: number }>();
  if (row && !(me && me.id === row.id)) {
    forgetVerifiedNickname(c);
    return c.json({ available: false, duplicate: true });
  }
  if (me) await rememberVerifiedNickname(c, me.id, n);
  return c.json(row ? { available: true, self: true } : { available: true });
});

/* ---------- 회원가입 ---------- */

auth.get('/register', async (c) => {
  if (c.get('user')) return c.redirect('/');
  const question = await issueCaptcha(c);
  return c.html(<RegisterPage error={null} captchaQuestion={question} />);
});

async function registerFail(c: Context<AppEnv>, error: string) {
  const captchaQuestion = await issueCaptcha(c);
  if (c.req.header('X-Register-Fetch') === '1') {
    return c.json({ error, captchaQuestion }, 400);
  }
  // 기존 서버와 같이 HTML 폼 오류는 200으로 다시 그린다.
  return c.html(<RegisterPage error={error} captchaQuestion={captchaQuestion} />);
}

auth.post('/register', async (c) => {
  const fail = (msg: string) => registerFail(c, msg);
  const db = c.env.DB;
  const ip = clientIp(c);

  const declared = Number(c.req.header('content-length') || '0');
  if (declared > REGISTER_BODY_MAX_BYTES) return fail('프로필 이미지는 3MB 이하여야 합니다.');

  let body: Record<string, string | File>;
  try {
    body = (await c.req.parseBody()) as Record<string, string | File>;
  } catch {
    return fail('요청을 읽을 수 없습니다. 다시 시도해주세요.');
  }

  const nickname = str(body.nickname).trim();
  const username = str(body.username).trim();
  const password = str(body.password);
  const passwordConfirm = str(body.passwordConfirm);
  const captcha = str(body.captcha).trim();

  if (await rate.isLimited(db, rate.REGISTER_BY_IP, ip)) {
    return fail('짧은 시간에 너무 많은 가입이 시도되었습니다. 잠시 후 다시 시도해주세요.');
  }
  if (!nickname || !username || !password || !passwordConfirm || !captcha) {
    return fail('모든 항목을 입력해주세요.');
  }
  if (!(await checkCaptcha(c, captcha))) {
    return fail('보안 문자가 올바르지 않습니다. 다시 시도해주세요.');
  }
  if (password !== passwordConfirm) return fail('비밀번호가 일치하지 않습니다.');
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return fail(`비밀번호는 ${PASSWORD_MIN}자 이상 ${PASSWORD_MAX}자 이하여야 합니다.`);
  }
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return fail(`아이디는 ${USERNAME_MIN}자 이상 ${USERNAME_MAX}자 이하여야 합니다.`);
  }
  if (!USERNAME_PATTERN.test(username)) return fail('아이디는 영문, 숫자, 밑줄(_)만 사용할 수 있습니다.');
  if (Array.from(nickname).length > NICKNAME_MAX) return fail(`닉네임은 ${NICKNAME_MAX}자 이하로 입력해주세요.`);

  if (await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first()) {
    return fail('이미 사용 중인 아이디입니다.');
  }
  if (await db.prepare('SELECT id FROM users WHERE nickname = ?').bind(nickname).first()) {
    return fail('이미 사용 중인 닉네임입니다.');
  }

  let avatar: { bytes: Uint8Array; mime: string } | null = null;
  const file = body.avatar;
  if (file instanceof File && file.size > 0) {
    if (file.size > AVATAR_MAX_BYTES) return fail('프로필 이미지는 3MB 이하여야 합니다.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = verifiedMime(bytes, IMAGE_MIMES);
    if (!mime) return fail('프로필 이미지는 JPG, PNG, GIF, WEBP만 가능합니다.');
    avatar = { bytes, mime };
  }

  let userId: number;
  try {
    const row = await db
      .prepare('INSERT INTO users (username, nickname, password_hash) VALUES (?, ?, ?) RETURNING id')
      .bind(username, nickname, await hashPassword(password))
      .first<{ id: number }>();
    if (!row) throw new Error('INSERT returned no row');
    userId = row.id;
  } catch (err) {
    // 중복 확인과 INSERT 사이에 같은 아이디가 먼저 가입된 경우
    if (String(err).includes('UNIQUE constraint failed: users.username')) {
      return fail('이미 사용 중인 아이디입니다.');
    }
    console.error('[register] 가입 실패', err);
    return fail('회원가입 중 오류가 발생했습니다. 다시 시도해주세요.');
  }
  await rate.hit(db, rate.REGISTER_BY_IP, ip);

  if (avatar) {
    // 아바타 저장이 실패해도 가입 자체는 유지한다 (기본 이미지로 표시됨).
    try {
      const key = `avatars/${userId}/${crypto.randomUUID()}`;
      await c.env.MEDIA.put(key, avatar.bytes, { httpMetadata: { contentType: avatar.mime } });
      await db.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(key, userId).run();
    } catch (err) {
      console.error('[register] 아바타 저장 실패', err);
    }
  }

  return c.redirect('/auth/login?registered=true');
});

export default auth;
