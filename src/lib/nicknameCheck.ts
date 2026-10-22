/**
 * 마이페이지 닉네임 변경: 「닉네임 중복 확인」을 통과한 값만 적용한다.
 * 기존에는 세션(req.session.mypageNicknameVerified)에 기억했지만, 여기서는 서명 쿠키에 담는다.
 * 값은 "<사용자 id>:<닉네임>"이라 다른 사용자의 확인 결과는 쓸 수 없다.
 */
import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { AppEnv } from '../types';

const COOKIE_NAME = 'portfolio_nickv';
/** 확인 결과 유지 시간: 30분 (확인 후 적용하기까지 충분한 시간) */
const VERIFIED_TTL_SEC = 30 * 60;

function buildCookieOptions(c: Context<AppEnv>) {
  return {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax' as const,
    path: '/'
  };
}

export async function rememberVerifiedNickname(c: Context<AppEnv>, userId: number, nickname: string) {
  await setSignedCookie(c, COOKIE_NAME, `${userId}:${encodeURIComponent(nickname)}`, c.env.AUTH_SECRET, {
    ...buildCookieOptions(c),
    maxAge: VERIFIED_TTL_SEC
  });
}

export function forgetVerifiedNickname(c: Context<AppEnv>) {
  deleteCookie(c, COOKIE_NAME, buildCookieOptions(c));
}

export async function isVerifiedNickname(c: Context<AppEnv>, userId: number, nickname: string): Promise<boolean> {
  const stored = await getSignedCookie(c, c.env.AUTH_SECRET, COOKIE_NAME);
  return typeof stored === 'string' && stored ===`${userId}:${encodeURIComponent(nickname)}`;
}
