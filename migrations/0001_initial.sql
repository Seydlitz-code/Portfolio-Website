-- 기존 config/database.js 스키마를 D1(SQLite)로 옮긴 초기 마이그레이션.
--
-- 기존과 달라진 점
--   * 바이너리(BLOB)는 DB에 넣지 않고 R2(env.MEDIA)에 저장한다. DB에는 R2 키와 메타데이터만 둔다.
--     - users.avatar / avatar_mime / avatar_blob      -> users.avatar_key
--     - persisted_binaries(kind, mime, data)           -> site_assets(kind, r2_key, mime)
--     - post_body_assets(mime, data)                   -> post_body_assets(r2_key, mime, size)
--   * users.password -> users.password_hash (PBKDF2, WebCrypto)
--   * express-session이 만들던 세션 테이블을 sessions로 직접 정의한다.
--   * 시간은 ISO 8601 UTC 문자열(예: 2026-10-21T14:21:47.123Z)로 저장한다.
--   * D1은 외래 키 제약을 항상 검사한다.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  nickname      TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  avatar_key    TEXT,
  is_admin      INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 게시판 (기존 이름 유지)
CREATE TABLE projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  name_ja     TEXT,
  description TEXT,
  order_num   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT    NOT NULL,
  title_ja   TEXT,
  content    TEXT    NOT NULL,
  project_id INTEGER REFERENCES projects(id),
  author_id  INTEGER REFERENCES users(id),
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_posts_project_created ON posts (project_id, created_at DESC);
CREATE INDEX idx_posts_created ON posts (created_at DESC);

CREATE TABLE comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id)    ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  parent_id  INTEGER          REFERENCES comments(id) ON DELETE CASCADE,
  content    TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_comments_post ON comments (post_id, created_at);
CREATE INDEX idx_comments_parent ON comments (parent_id);

CREATE TABLE comment_notifications (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  comment_id        INTEGER NOT NULL UNIQUE REFERENCES comments(id) ON DELETE CASCADE,
  post_id           INTEGER NOT NULL REFERENCES posts(id)    ON DELETE CASCADE,
  actor_user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  read_at           TEXT,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_comment_notifications_recipient ON comment_notifications (recipient_user_id, read_at);

CREATE TABLE site_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 사이트 공용 이미지(프로필 이미지 등). 실제 파일은 R2에 있다.
CREATE TABLE site_assets (
  kind   TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL UNIQUE,
  mime   TEXT NOT NULL
);

-- 게시물 본문 첨부(이미지·동영상). 실제 파일은 R2에 있고, 미참조 정리를 위해 메타데이터를 둔다.
CREATE TABLE post_body_assets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  r2_key     TEXT    NOT NULL UNIQUE,
  mime       TEXT    NOT NULL,
  size       INTEGER NOT NULL CHECK (size >= 0),
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_post_body_assets_created ON post_body_assets (created_at);

-- 로그인 세션. id에는 쿠키 토큰 원문이 아니라 SHA-256 해시를 저장한다.
CREATE TABLE sessions (
  id         TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- 기존 seedSiteSettings 기본값
INSERT INTO site_settings (key, value) VALUES
  ('site_name', 'Donghawan Lee / @lilip'),
  ('bio', ''),
  ('profile_image', ''),
  ('all_posts_intro_ko', '작성된 모든 게시물을 확인할 수 있는 게시판 입니다.'),
  ('all_posts_intro_ja', '作成された全ての投稿を確認できる掲示板です。');
