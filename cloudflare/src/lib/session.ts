import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, SessionUser } from '../types';

const COOKIE_NAME = 'portfolio_sid';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** DB에는 쿠키 토큰 원문 대신 SHA-256 해시를 저장한다. DB가 새어도 세션을 훔쳐 쓸 수 없다. */
async function tokenId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isHttps(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

export function avatarUrlFor(userId: number, avatarKey: string | null): string | null {
  return avatarKey ? `/media/user/${userId}/avatar` : null;
}

/** 로그인 성공 시 호출. 매번 새 토큰을 만들기 때문에 세션 고정 공격이 통하지 않는다. */
export async function startSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await tokenId(token), userId, expiresAt)
    .run();
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000
  });
}

export async function loadSessionUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token || token.length > 128) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.nickname, u.avatar_key, u.is_admin
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`
  )
    .bind(await tokenId(token), new Date().toISOString())
    .first<{ id: number; username: string; nickname: string; avatar_key: string | null; is_admin: number }>();
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatarUrl: avatarUrlFor(row.id, row.avatar_key),
    isAdmin: row.is_admin === 1
  };
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, COOKIE_NAME);
  if (token && token.length <= 128) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await tokenId(token)).run();
  }
  deleteCookie(c, COOKIE_NAME, { path: '/', secure: isHttps(c) });
}
