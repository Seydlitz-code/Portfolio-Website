/** 로그인·로그아웃·회원가입·중복 확인 (기존 routes/auth.js 이식) */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { LoginPage, RegisterPage } from '../views/auth';
import { hashPassword, verifyPassword } from '../lib/password';
import { endSession, prepareSession } from '../lib/session';
import { checkCaptcha, issueCaptcha } from '../lib/captcha';
import { getClientIp, toSafeRedirectPath } from '../lib/security';
import { isFormBodyTooLarge } from '../lib/http';
import { AVATAR_IMAGE_RULE, checkImageFile } from '../lib/imageCheck';
import * as rate from '../lib/rateLimit';
import { forgetVerifiedNickname, rememberVerifiedNickname } from '../lib/nicknameCheck';
import {
  NICKNAME_MAX,
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_PATTERN
} from '../lib/accountRules';

/** 로그인 비밀번호 입력 상한: 128글자. 관리자 비밀번호 최대 64글자보다 넉넉히 두고, 해시 계산 전에 터무니없이 긴 입력을 거른다 */
const LOGIN_PASSWORD_MAX = 128;

const auth = new Hono<AppEnv>();

const toStringValue = (value: unknown) => (typeof value === 'string' ? value : '');

function buildLoginAccountKey(c: Context<AppEnv>, username: string) {
  return `${getClientIp(c)}|${username.trim().toLowerCase()}`;
}

/* ---------- 로그인 ---------- */

auth.get('/login', (c) => {
  const next = toSafeRedirectPath(c.req.query('next'));
  if (c.get('user')) return c.redirect(next || '/');
  const success = c.req.query('registered') === 'true' ? '회원가입이 완료되었습니다. 로그인해주세요.' : null;
  return c.html(<LoginPage error={null} success={success} next={next} />);
});

auth.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const username = toStringValue(body.username).trim();
  const password = toStringValue(body.password);
  const nextForForm = toSafeRedirectPath(body.next) || toSafeRedirectPath(c.req.query('next'));
  const fail = (error: string, status: 200 | 429 = 200) =>
    c.html(<LoginPage error={error} success={null} next={nextForForm} />, status);

  if (!username || !password) return fail('아이디와 비밀번호를 입력해주세요.');

  const db = c.env.DB;
  const ip = getClientIp(c);
  const accountKey = buildLoginAccountKey(c, username);
  // 두 한도와 사용자 조회를 D1 왕복 한 번으로 확인한다.
  const [accountLimit, ipLimit, userRes] = await db.batch([
    rate.buildLimitCheck(db, rate.LOGIN_FAIL_BY_ACCOUNT, accountKey),
    rate.buildLimitCheck(db, rate.LOGIN_FAIL_BY_IP, ip),
    db.prepare('SELECT id, password_hash FROM users WHERE username = ?').bind(username)
  ]);
  if (rate.isOverLimit(accountLimit, rate.LOGIN_FAIL_BY_ACCOUNT) || rate.isOverLimit(ipLimit, rate.LOGIN_FAIL_BY_IP)) {
    return fail('로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요.', 429);
  }

  const user = userRes.results[0] as { id: number; password_hash: string } | undefined;
  // 없는 아이디도 같은 계산을 하도록 verifyPassword에 null을 넘긴다 (응답 시간으로 계정 존재가 드러나지 않게).
  const isPasswordOk =
    password.length <= LOGIN_PASSWORD_MAX && (await verifyPassword(password, user ? user.password_hash : null));

  if (!user || !isPasswordOk) {
    await db.batch([
      rate.buildHit(db, rate.LOGIN_FAIL_BY_ACCOUNT, accountKey),
      rate.buildHit(db, rate.LOGIN_FAIL_BY_IP, ip)
    ]);
    return fail('아이디 또는 비밀번호가 올바르지 않습니다.');
  }

  // 실패 기록 초기화와 새 세션 저장을 한 번에 보낸다.
  const session = await prepareSession(c, user.id);
  await db.batch([rate.buildReset(db, rate.LOGIN_FAIL_BY_ACCOUNT, accountKey), session.statement]);
  session.setCookie();
  return c.redirect(nextForForm || '/');
});

auth.post('/logout', async (c) => {
  await endSession(c);
  return c.redirect('/');
});

/* ---------- 중복 확인 (register.js·mypage-account.js가 호출) ---------- */

auth.get('/check-username', async (c) => {
  const username = toStringValue(c.req.query('username')).trim();
  if (!username) return c.json({ available: false, message: '아이디를 입력해주세요.' });
  if (username.length < USERNAME_MIN) return c.json({ available: false, message: '아이디는 3자 이상이어야 합니다.' });
  if (username.length > USERNAME_MAX) return c.json({ available: false, message: '아이디가 너무 깁니다.' });
  if (!USERNAME_PATTERN.test(username)) {
    return c.json({ available: false, message: '영문, 숫자, 밑줄(_)만 사용할 수 있습니다.' });
  }
  const row = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first<{ id: number }>();
  return c.json(row ? { available: false, duplicate: true } : { available: true });
});

/** 로그인한 상태에서 통과하면 마이페이지 닉네임 변경에 쓸 수 있도록 확인 결과를 기억한다. */
auth.get('/check-nickname', async (c) => {
  const nickname = toStringValue(c.req.query('nickname')).trim();
  const me = c.get('user');
  if (!nickname) {
    forgetVerifiedNickname(c);
    return c.json({ available: false, message: '닉네임을 입력해주세요.' });
  }
  if (Array.from(nickname).length > NICKNAME_MAX) {
    forgetVerifiedNickname(c);
    return c.json({ available: false, message: '닉네임은 20자 이하로 입력해주세요.' });
  }
  const row = await c.env.DB.prepare('SELECT id FROM users WHERE nickname = ?').bind(nickname).first<{ id: number }>();
  if (row && !(me && me.id === row.id)) {
    forgetVerifiedNickname(c);
    return c.json({ available: false, duplicate: true });
  }
  if (me) await rememberVerifiedNickname(c, me.id, nickname);
  return c.json(row ? { available: true, self: true } : { available: true });
});

/* ---------- 회원가입 ---------- */

auth.get('/register', async (c) => {
  if (c.get('user')) return c.redirect('/');
  const question = await issueCaptcha(c);
  return c.html(<RegisterPage error={null} captchaQuestion={question} />);
});

async function renderRegisterError(c: Context<AppEnv>, error: string) {
  const captchaQuestion = await issueCaptcha(c);
  if (c.req.header('X-Register-Fetch') === '1') {
    return c.json({ error, captchaQuestion }, 400);
  }
  // 기존 서버와 같이 HTML 폼 오류는 200으로 다시 그린다.
  return c.html(<RegisterPage error={error} captchaQuestion={captchaQuestion} />);
}

auth.post('/register', async (c) => {
  const fail = (message: string) => renderRegisterError(c, message);
  const db = c.env.DB;
  const ip = getClientIp(c);

  if (isFormBodyTooLarge(c, AVATAR_IMAGE_RULE.maxBytes)) return fail(AVATAR_IMAGE_RULE.tooLargeMessage);

  let body: Record<string, string | File>;
  try {
    body = (await c.req.parseBody()) as Record<string, string | File>;
  } catch {
    return fail('요청을 읽을 수 없습니다. 다시 시도해주세요.');
  }

  const nickname = toStringValue(body.nickname).trim();
  const username = toStringValue(body.username).trim();
  const password = toStringValue(body.password);
  const passwordConfirm = toStringValue(body.passwordConfirm);
  const captcha = toStringValue(body.captcha).trim();

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

  // 가입 횟수 제한과 아이디·닉네임 중복을 D1 왕복 한 번으로 확인한다.
  const [limitRes, usernameRes, nicknameRes] = await db.batch([
    rate.buildLimitCheck(db, rate.REGISTER_BY_IP, ip),
    db.prepare('SELECT id FROM users WHERE username = ?').bind(username),
    db.prepare('SELECT id FROM users WHERE nickname = ?').bind(nickname)
  ]);
  if (rate.isOverLimit(limitRes, rate.REGISTER_BY_IP)) {
    return fail('짧은 시간에 너무 많은 가입이 시도되었습니다. 잠시 후 다시 시도해주세요.');
  }
  if (usernameRes.results.length) return fail('이미 사용 중인 아이디입니다.');
  if (nicknameRes.results.length) return fail('이미 사용 중인 닉네임입니다.');

  let avatar: { file: File; mime: string } | null = null;
  const file = body.avatar;
  if (file instanceof File && file.size > 0) {
    const image = await checkImageFile(file, AVATAR_IMAGE_RULE);
    if ('error' in image) return fail(image.error);
    avatar = { file, mime: image.mime };
  }

  let userId: number;
  try {
    // 가입과 가입 횟수 기록을 한 번에 보낸다. batch는 한 트랜잭션이라 가입이 실패하면 기록도 남지 않는다.
    const [insertRes] = await db.batch([
      db
        .prepare('INSERT INTO users (username, nickname, password_hash) VALUES (?, ?, ?) RETURNING id')
        .bind(username, nickname, await hashPassword(password)),
      rate.buildHit(db, rate.REGISTER_BY_IP, ip)
    ]);
    const row = insertRes.results[0] as { id: number } | undefined;
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

  if (avatar) {
    // 아바타 저장이 실패해도 가입 자체는 유지한다 (기본 이미지로 표시됨).
    try {
      const key = `avatars/${userId}/${crypto.randomUUID()}`;
      await c.env.MEDIA.put(key, avatar.file, { httpMetadata: { contentType: avatar.mime } });
      await db.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(key, userId).run();
    } catch (err) {
      console.error('[register] 아바타 저장 실패', err);
    }
  }

  return c.redirect('/auth/login?registered=true');
});

export default auth;
