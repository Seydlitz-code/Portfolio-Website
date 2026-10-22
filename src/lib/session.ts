/** 로그인 세션: 쿠키 토큰 발급·조회·삭제. 세션은 D1 sessions 테이블에 둔다. */
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, SessionUser } from '../types';

const COOKIE_NAME = 'portfolio_sid';
/** 세션 유지 기간: 7일 (기존 express-session의 maxAge와 같음) */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 세션 토큰 길이: 32바이트 무작위 값 (base64url로 43자) */
const TOKEN_BYTES = 32;
/** 세션 쿠키 값 최대 길이: 128글자. 실제 토큰(32바이트 base64url = 43글자)보다 넉넉히 두고, 이보다 길면 해시 계산 없이 버린다 */
const TOKEN_MAX_LENGTH = 128;

function createRandomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** DB에는 쿠키 토큰 원문 대신 SHA-256 해시를 저장한다. DB가 새어도 세션을 훔쳐 쓸 수 없다. */
async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isHttps(c: Context<AppEnv>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

function buildAvatarUrl(userId: number, avatarKey: string | null): string | null {
  return avatarKey ? `/media/user/${userId}/avatar` : null;
}

/**
 * 로그인 성공 시 새 세션을 준비한다. 매번 새 토큰을 만들기 때문에 세션 고정 공격이 통하지 않는다.
 * 저장 쿼리(statement)를 돌려주므로 다른 쿼리와 한 번의 db.batch로 보낼 수 있다.
 * 저장이 끝난 뒤 setCookie()를 불러 브라우저에 토큰을 보낸다.
 */
export async function prepareSession(
  c: Context<AppEnv>,
  userId: number
): Promise<{ statement: D1PreparedStatement; setCookie: () => void }> {
  const token = createRandomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const statement = c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(
    await hashToken(token),
    userId,
    expiresAt
  );
  return {
    statement,
    setCookie: () =>
      setCookie(c, COOKIE_NAME, token, {
        httpOnly: true,
        secure: isHttps(c),
        sameSite: 'Lax',
        path: '/',
        maxAge: SESSION_TTL_MS / 1000
      })
  };
}

type SessionRow = {
  id: number;
  username: string;
  nickname: string;
  avatar_key: string | null;
  is_admin: number;
  unread_count: number;
};

/**
 * 쿠키의 세션으로 로그인 사용자를 찾는다.
 * 관리자 메뉴에 쓰는 안 읽은 알림 수도 같은 쿼리에서 함께 세어 D1 왕복을 한 번으로 줄인다.
 */
export async function loadSessionUser(
  c: Context<AppEnv>
): Promise<{ user: SessionUser | null; unreadCount: number }> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token || token.length > TOKEN_MAX_LENGTH) return { user: null, unreadCount: 0 };
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.nickname, u.avatar_key, u.is_admin,
            CASE WHEN u.is_admin = 1 THEN
              (SELECT COUNT(*) FROM comment_notifications n WHERE n.recipient_user_id = u.id AND n.read_at IS NULL)
            ELSE 0 END AS unread_count
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`
  )
    .bind(await hashToken(token), new Date().toISOString())
    .first<SessionRow>();
  if (!row) return { user: null, unreadCount: 0 };
  return {
    user: {
      id: row.id,
      username: row.username,
      nickname: row.nickname,
      avatarUrl: buildAvatarUrl(row.id, row.avatar_key),
      isAdmin: row.is_admin === 1
    },
    unreadCount: Number(row.unread_count ?? 0)
  };
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, COOKIE_NAME);
  if (token && token.length <= TOKEN_MAX_LENGTH) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await hashToken(token)).run();
  }
  deleteCookie(c, COOKIE_NAME, { path: '/', secure: isHttps(c) });
}
