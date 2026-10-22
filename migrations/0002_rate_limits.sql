-- 로그인·회원가입 시도 제한 카운터.
-- 기존 서버는 메모리(Map)에 기록했지만, Workers는 요청마다 다른 곳에서 실행될 수 있어 D1에 둔다.
-- window_start는 밀리초 단위 UNIX 시간이다. 오래된 행은 매일 Cron에서 지운다.
CREATE TABLE rate_limits (
  key          TEXT    PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
CREATE INDEX idx_rate_limits_window ON rate_limits (window_start);
