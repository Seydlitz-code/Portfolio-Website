import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { AppEnv } from '../types';

/**
 * 회원가입 로봇 방지 문제 (덧셈).
 * 기존에는 정답을 서버 세션에 넣었지만, 여기서는 로그인 전 세션이 없으므로
 * 정답과 만료 시각을 AUTH_SECRET으로 서명한 쿠키에 담는다. 브라우저에서 바꾸면 서명 검증에 실패한다.
 * 확인할 때마다 쿠키를 지우고 새 문제를 내기 때문에 같은 쿠키는 한 번만 쓰인다
 * (쿠키를 복사해 다시 보내는 공격은 가입 횟수 제한(REGISTER_BY_IP)으로 막는다).
 */
const COOKIE_NAME = 'portfolio_captcha';
const TTL_SEC = 10 * 60;

function cookieOpts(c: Context<AppEnv>) {
  return {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict' as const,
    path: '/auth'
  };
}

/** 새 문제를 만들고 정답 쿠키를 심은 뒤 문제 문자열을 돌려준다. */
export async function issueCaptcha(c: Context<AppEnv>): Promise<string> {
  const a = (crypto.getRandomValues(new Uint32Array(1))[0] % 10) + 1;
  const b = (crypto.getRandomValues(new Uint32Array(1))[0] % 10) + 1;
  const exp = Date.now() + TTL_SEC * 1000;
  await setSignedCookie(c, COOKIE_NAME, `${a + b}.${exp}`, c.env.AUTH_SECRET, {
    ...cookieOpts(c),
    maxAge: TTL_SEC
  });
  return `${a} + ${b} = ?`;
}

/** 답을 확인하고 쿠키는 바로 지운다(1회용). */
export async function checkCaptcha(c: Context<AppEnv>, answer: string): Promise<boolean> {
  const value = await getSignedCookie(c, c.env.AUTH_SECRET, COOKIE_NAME);
  deleteCookie(c, COOKIE_NAME, cookieOpts(c));
  if (typeof value !== 'string') return false;
  const [expected, exp] = value.split('.');
  if (!expected || !exp || Number(exp) < Date.now()) return false;
  return /^\d{1,3}$/.test(answer) && Number(answer) === Number(expected);
}
