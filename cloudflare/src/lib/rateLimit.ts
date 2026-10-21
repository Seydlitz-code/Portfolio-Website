/**
 * 고정 시간 창 카운터 (D1). 기존 lib/security.js의 createWindowCounter와 같은 동작이다.
 * hit로 증가, isLimited로 한도 초과 확인, reset으로 초기화.
 */
export type WindowRule = { prefix: string; windowMs: number; max: number };

export const LOGIN_FAIL_BY_ACCOUNT: WindowRule = { prefix: 'login:acct', windowMs: 15 * 60 * 1000, max: 8 };
export const LOGIN_FAIL_BY_IP: WindowRule = { prefix: 'login:ip', windowMs: 15 * 60 * 1000, max: 30 };
export const REGISTER_BY_IP: WindowRule = { prefix: 'register:ip', windowMs: 60 * 60 * 1000, max: 5 };

/** Cron 정리 기준: 가장 긴 창보다 넉넉하게 */
export const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

function fullKey(rule: WindowRule, key: string): string {
  return `${rule.prefix}:${key}`;
}

export async function isLimited(db: D1Database, rule: WindowRule, key: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT count FROM rate_limits WHERE key = ? AND window_start > ?')
    .bind(fullKey(rule, key), Date.now() - rule.windowMs)
    .first<{ count: number }>();
  return row != null && row.count >= rule.max;
}

export async function hit(db: D1Database, rule: WindowRule, key: string): Promise<void> {
  const now = Date.now();
  const expired = now - rule.windowMs;
  await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count        = CASE WHEN window_start <= ?3 THEN 1   ELSE count + 1   END,
         window_start = CASE WHEN window_start <= ?3 THEN ?2  ELSE window_start END`
    )
    .bind(fullKey(rule, key), now, expired)
    .run();
}

export async function reset(db: D1Database, rule: WindowRule, key: string): Promise<void> {
  await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(fullKey(rule, key)).run();
}
