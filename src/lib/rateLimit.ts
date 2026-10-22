/**
 * 고정 시간 창 카운터 (D1). 기존 lib/security.js의 createWindowCounter를 D1로 옮겼다.
 * Workers는 요청마다 다른 isolate에서 실행될 수 있어 메모리 카운터를 쓸 수 없기 때문이다.
 * 같은 요청에서 여러 규칙을 확인할 때는 build* 함수로 쿼리만 만들어 db.batch로 한 번에 보낸다.
 */
export type WindowRule = { prefix: string; windowMs: number; max: number };

type CountRow = { count: number };

/** 로그인 실패: 같은 IP+아이디로 15분에 8회까지 (기존 서버와 같은 값) */
export const LOGIN_FAIL_BY_ACCOUNT: WindowRule = { prefix: 'login:acct', windowMs: 15 * 60 * 1000, max: 8 };
/** 로그인 실패: 같은 IP 전체로 15분에 30회까지 (여러 아이디를 바꿔 가며 시도하는 경우) */
export const LOGIN_FAIL_BY_IP: WindowRule = { prefix: 'login:ip', windowMs: 15 * 60 * 1000, max: 30 };
/** 회원가입 성공: 같은 IP로 1시간에 5회까지 */
export const REGISTER_BY_IP: WindowRule = { prefix: 'register:ip', windowMs: 60 * 60 * 1000, max: 5 };

/** Cron 정리 기준: 가장 긴 창(1시간)보다 넉넉하게 24시간 */
export const RATE_LIMIT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** rate_limits 테이블에 실제로 저장되는 키 (다른 쿼리에서 이 기록을 함께 읽을 때 쓴다) */
export function buildRateLimitKey(rule: WindowRule, key: string): string {
  return `${rule.prefix}:${key}`;
}

/** 한도 확인 쿼리. 결과는 isOverLimit으로 해석한다. */
export function buildLimitCheck(db: D1Database, rule: WindowRule, key: string): D1PreparedStatement {
  return db
    .prepare('SELECT count FROM rate_limits WHERE key = ? AND window_start > ?')
    .bind(buildRateLimitKey(rule, key), Date.now() - rule.windowMs);
}

/**
 * buildLimitCheck 결과 해석. db.batch는 여러 종류의 쿼리 결과를 한 배열로 돌려주므로
 * 결과 타입을 unknown으로 받고, 이 쿼리의 행 모양(CountRow)으로 여기서 한 번만 좁힌다.
 */
export function isOverLimit(result: D1Result<unknown>, rule: WindowRule): boolean {
  const row = result.results[0] as CountRow | undefined;
  return row != null && row.count >= rule.max;
}

/**
 * 횟수를 1 늘리는 쿼리. 창이 지났으면 1부터 다시 센다.
 * RETURNING으로 늘린 뒤의 횟수를 돌려준다 (1이면 이 창의 첫 기록).
 */
export function buildHit(db: D1Database, rule: WindowRule, key: string): D1PreparedStatement {
  const now = Date.now();
  return db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
       ON CONFLICT (key) DO UPDATE SET
         count        = CASE WHEN window_start <= ?3 THEN 1   ELSE count + 1   END,
         window_start = CASE WHEN window_start <= ?3 THEN ?2  ELSE window_start END
       RETURNING count`
    )
    .bind(buildRateLimitKey(rule, key), now, now - rule.windowMs);
}

export function buildReset(db: D1Database, rule: WindowRule, key: string): D1PreparedStatement {
  return db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(buildRateLimitKey(rule, key));
}
