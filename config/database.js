const Database = require('better-sqlite3');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

/**
 * 로컬: SQLite 파일 (<프로젝트>/data, DATA_DIR로 경로 지정 가능)
 * Railway 등: 환경변수 DATABASE_URL 이 있으면 PostgreSQL만 사용(게시물·계정·세션 등 영구 저장).
 * 업로드 프로필 이미지는 DB(persisted_binaries / users.avatar_blob)에 저장해 배포 시 컨테이너 디스크가
 * 초기화돼도 이미지가 사라지지 않습니다.
 *
 * 관리자 계정: 소스에 비밀번호를 두지 않습니다. DB에 is_admin=1 사용자가 없을 때만
 * 서버 환경변수 ADMIN_BOOTSTRAP_USERNAME, ADMIN_BOOTSTRAP_PASSWORD(평문·서버에서 bcrypt 해시)로
 * 최초 1명을 생성합니다. 선택: ADMIN_BOOTSTRAP_NICKNAME.
 * 프로덕션에서 관리자가 없는데 위 변수가 없으면 기동을 중단합니다.
 */
function usePostgres() {
  return Boolean(process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim());
}

function getDataDir() {
  const fromEnv = process.env.DATA_DIR != null && String(process.env.DATA_DIR).trim();
  if (fromEnv) {
    return path.resolve(String(process.env.DATA_DIR).trim());
  }
  const fallback = path.join(__dirname, '..', 'data');
  if (
    !usePostgres() &&
    (process.env.NODE_ENV === 'production' || process.env.RENDER === 'true')
  ) {
    console.warn(
      '[database] SQLite — DATA_DIR 미설정: ' +
        fallback +
        ' (에페멀 디스크면 배포 시 초기화될 수 있습니다. PostgreSQL은 DATABASE_URL을 사용하세요.)'
    );
  }
  return fallback;
}

const DB_FILE = 'portfolio.db';
let db;
let pgPool;

function getDb() {
  if (usePostgres()) {
    throw new Error('PostgreSQL 모드에서는 getDb() 대신 lib/db.js의 get/all/run을 사용하세요.');
  }
  if (!db) {
    const dataDir = getDataDir();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, DB_FILE);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function getPool() {
  if (!usePostgres()) {
    throw new Error('SQLite 모드에서는 getPool()을 사용할 수 없습니다.');
  }
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      ssl:
        process.env.PGSSLMODE === 'disable'
          ? false
          : process.env.NODE_ENV === 'production'
            ? { rejectUnauthorized: false }
            : undefined
    });
  }
  return pgPool;
}

function initializeSqliteSync() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      nickname TEXT NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT,
      avatar_mime TEXT,
      avatar_blob BLOB,
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_ja TEXT,
      description TEXT,
      order_num INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      project_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      parent_id INTEGER,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS persisted_binaries (
      kind TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      data BLOB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS post_body_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const postCols = database.prepare('PRAGMA table_info(posts)').all();
  if (!postCols.some((c) => c.name === 'view_count')) {
    database.exec('ALTER TABLE posts ADD COLUMN view_count INTEGER DEFAULT 0');
  }
  if (!postCols.some((c) => c.name === 'author_id')) {
    database.exec('ALTER TABLE posts ADD COLUMN author_id INTEGER');
    const adminUser = database
      .prepare('SELECT id FROM users WHERE is_admin = 1 ORDER BY id ASC LIMIT 1')
      .get();
    if (adminUser) {
      database.prepare('UPDATE posts SET author_id = ? WHERE author_id IS NULL').run(adminUser.id);
    }
  }
  let postCols2 = database.prepare('PRAGMA table_info(posts)').all();
  if (!postCols2.some((c) => c.name === 'title_ja')) {
    database.exec('ALTER TABLE posts ADD COLUMN title_ja TEXT');
    postCols2 = database.prepare('PRAGMA table_info(posts)').all();
  }

  let userCols = database.prepare('PRAGMA table_info(users)').all();
  if (!userCols.some((c) => c.name === 'avatar')) {
    database.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
    userCols = database.prepare('PRAGMA table_info(users)').all();
  }
  if (!userCols.some((c) => c.name === 'avatar_mime')) {
    database.exec('ALTER TABLE users ADD COLUMN avatar_mime TEXT');
    userCols = database.prepare('PRAGMA table_info(users)').all();
  }
  if (!userCols.some((c) => c.name === 'avatar_blob')) {
    database.exec('ALTER TABLE users ADD COLUMN avatar_blob');
  }

  let commentCols = database.prepare('PRAGMA table_info(comments)').all();
  if (!commentCols.some((c) => c.name === 'parent_id')) {
    database.exec('ALTER TABLE comments ADD COLUMN parent_id INTEGER');
  }
  commentCols = database.prepare('PRAGMA table_info(comments)').all();
  if (!commentCols.some((c) => c.name === 'updated_at')) {
    database.exec('ALTER TABLE comments ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    database.exec('UPDATE comments SET updated_at = created_at WHERE updated_at IS NULL');
  }

  console.log('[database] SQLite 파일:', path.join(getDataDir(), DB_FILE));
}

async function pgColumnExists(pool, table, column) {
  const r = await pool.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column]
  );
  return r.rows.length > 0;
}

async function initializePostgres() {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      nickname TEXT NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT,
      avatar_mime TEXT,
      avatar_blob BYTEA,
      is_admin SMALLINT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      name_ja TEXT,
      description TEXT,
      order_num INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      project_id INTEGER REFERENCES projects(id),
      author_id INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      view_count INTEGER DEFAULT 0
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS persisted_binaries (
      kind TEXT PRIMARY KEY,
      mime TEXT NOT NULL,
      data BYTEA NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_body_assets (
      id SERIAL PRIMARY KEY,
      mime TEXT NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  if (!(await pgColumnExists(pool, 'posts', 'view_count'))) {
    await pool.query('ALTER TABLE posts ADD COLUMN view_count INTEGER DEFAULT 0');
  }
  if (!(await pgColumnExists(pool, 'posts', 'author_id'))) {
    await pool.query('ALTER TABLE posts ADD COLUMN author_id INTEGER REFERENCES users(id)');
    const adminRow = await pool.query(
      'SELECT id FROM users WHERE is_admin = 1 ORDER BY id ASC LIMIT 1'
    );
    if (adminRow.rows[0]) {
      await pool.query('UPDATE posts SET author_id = $1 WHERE author_id IS NULL', [
        adminRow.rows[0].id
      ]);
    }
  }
  if (!(await pgColumnExists(pool, 'posts', 'title_ja'))) {
    await pool.query('ALTER TABLE posts ADD COLUMN title_ja TEXT');
  }
  if (!(await pgColumnExists(pool, 'users', 'avatar'))) {
    await pool.query('ALTER TABLE users ADD COLUMN avatar TEXT');
  }
  if (!(await pgColumnExists(pool, 'users', 'avatar_mime'))) {
    await pool.query('ALTER TABLE users ADD COLUMN avatar_mime TEXT');
  }
  if (!(await pgColumnExists(pool, 'users', 'avatar_blob'))) {
    await pool.query('ALTER TABLE users ADD COLUMN avatar_blob BYTEA');
  }

  if (!(await pgColumnExists(pool, 'comments', 'parent_id'))) {
    await pool.query(
      'ALTER TABLE comments ADD COLUMN parent_id INTEGER REFERENCES comments(id) ON DELETE CASCADE'
    );
  }
  if (!(await pgColumnExists(pool, 'comments', 'updated_at'))) {
    await pool.query(
      'ALTER TABLE comments ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP'
    );
    await pool.query('UPDATE comments SET updated_at = created_at WHERE updated_at IS NULL');
  }

  await seedDefaultsPg(pool);

  console.log('[database] PostgreSQL 연결됨 (DATABASE_URL)');
}

function trimEnv(name) {
  const v = process.env[name];
  return v != null ? String(v).trim() : '';
}

function isProductionLike() {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.RAILWAY_ENVIRONMENT === 'production' ||
    process.env.RENDER === 'true'
  );
}

function validateBootstrapUsername(u) {
  if (!u || u.length < 3 || u.length > 30) {
    return 'ADMIN_BOOTSTRAP_USERNAME은 3~30자여야 합니다.';
  }
  if (!/^[a-zA-Z0-9_]+$/.test(u)) {
    return 'ADMIN_BOOTSTRAP_USERNAME은 영문, 숫자, 밑줄(_)만 사용할 수 있습니다.';
  }
  return null;
}

function validateBootstrapPassword(p) {
  if (!p || p.length < 8) {
    return 'ADMIN_BOOTSTRAP_PASSWORD는 8자 이상이어야 합니다.';
  }
  if (p.length > 72) {
    return 'bcrypt 호환을 위해 ADMIN_BOOTSTRAP_PASSWORD는 72자 이하여야 합니다.';
  }
  return null;
}

function readBootstrapPasswordRaw() {
  return process.env.ADMIN_BOOTSTRAP_PASSWORD != null
    ? String(process.env.ADMIN_BOOTSTRAP_PASSWORD)
    : '';
}

function seedSiteSettingsSqlite(database) {
  const defaults = {
    site_name: 'Donghawan Lee / @lilip',
    bio: '',
    profile_image: '',
    all_posts_intro_ko: '작성된 모든 게시물을 확인할 수 있는 게시판 입니다.',
    all_posts_intro_ja: '作成された全ての投稿を確認できる掲示板です。'
  };
  const insertSetting = database.prepare(
    'INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of Object.entries(defaults)) {
    insertSetting.run(key, value);
  }
}

function ensureBootstrapAdminSqlite(database) {
  const anyAdmin = database.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get();
  if (anyAdmin) return;

  const username = trimEnv('ADMIN_BOOTSTRAP_USERNAME');
  const password = readBootstrapPasswordRaw();
  const nickname = trimEnv('ADMIN_BOOTSTRAP_NICKNAME') || username || 'Admin';

  let vErr = validateBootstrapUsername(username);
  if (!vErr) vErr = validateBootstrapPassword(password);
  if (vErr) {
    if (isProductionLike()) {
      console.error('[database] ' + vErr);
      console.error(
        '[database] 관리자(is_admin=1)가 없습니다. ADMIN_BOOTSTRAP_USERNAME·ADMIN_BOOTSTRAP_PASSWORD를 비밀 환경변수로 설정한 뒤 재시작하세요.'
      );
      process.exit(1);
    }
    console.warn('[database] 관리자 부트스트랩 생략: ' + vErr);
    console.warn(
      '[database] 개발: 위 환경변수를 설정하면 최초 관리자 1명이 생성됩니다(소스·Git에 비밀번호를 넣지 마세요).'
    );
    return;
  }

  const taken = database.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (taken) {
    const msg = `아이디 "${username}"가 이미 사용 중입니다. 다른 ADMIN_BOOTSTRAP_USERNAME을 쓰세요.`;
    console.error('[database] ' + msg);
    if (isProductionLike()) process.exit(1);
    return;
  }

  const hash = bcrypt.hashSync(password, 12);
  database
    .prepare(
      'INSERT INTO users (username, nickname, password, is_admin, avatar) VALUES (?, ?, ?, ?, ?)'
    )
    .run(username, nickname, hash, 1, '/images/default-admin-avatar.png');
  console.log(
    '[database] 부트스트랩 관리자가 생성되었습니다. 로그인 후 비밀번호를 변경하고, 가능하면 ADMIN_BOOTSTRAP_* 환경변수를 제거하세요.'
  );
}

async function seedSiteSettingsPg(pool) {
  const defaults = {
    site_name: 'Donghawan Lee / @lilip',
    bio: '',
    profile_image: '',
    all_posts_intro_ko: '작성된 모든 게시물을 확인할 수 있는 게시판 입니다.',
    all_posts_intro_ja: '作成された全ての投稿を確認できる掲示板です。'
  };
  for (const [key, value] of Object.entries(defaults)) {
    await pool.query(
      `INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING`,
      [key, value]
    );
  }
}

async function ensureBootstrapAdminPg(pool) {
  const adminRow = await pool.query('SELECT id FROM users WHERE is_admin = 1 LIMIT 1');
  if (adminRow.rows.length > 0) return;

  const username = trimEnv('ADMIN_BOOTSTRAP_USERNAME');
  const password = readBootstrapPasswordRaw();
  const nickname = trimEnv('ADMIN_BOOTSTRAP_NICKNAME') || username || 'Admin';

  let vErr = validateBootstrapUsername(username);
  if (!vErr) vErr = validateBootstrapPassword(password);
  if (vErr) {
    if (isProductionLike()) {
      console.error('[database] ' + vErr);
      console.error(
        '[database] 관리자(is_admin=1)가 없습니다. ADMIN_BOOTSTRAP_USERNAME·ADMIN_BOOTSTRAP_PASSWORD를 비밀 환경변수로 설정한 뒤 재시작하세요.'
      );
      process.exit(1);
    }
    console.warn('[database] 관리자 부트스트랩 생략: ' + vErr);
    console.warn(
      '[database] 개발: 위 환경변수를 설정하면 최초 관리자 1명이 생성됩니다(소스·Git에 비밀번호를 넣지 마세요).'
    );
    return;
  }

  const taken = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (taken.rows.length > 0) {
    const msg = `아이디 "${username}"가 이미 사용 중입니다. 다른 ADMIN_BOOTSTRAP_USERNAME을 쓰세요.`;
    console.error('[database] ' + msg);
    if (isProductionLike()) process.exit(1);
    return;
  }

  const hash = bcrypt.hashSync(password, 12);
  await pool.query(
    `INSERT INTO users (username, nickname, password, is_admin, avatar) VALUES ($1, $2, $3, $4, $5)`,
    [username, nickname, hash, 1, '/images/default-admin-avatar.png']
  );
  console.log(
    '[database] 부트스트랩 관리자가 생성되었습니다. 로그인 후 비밀번호를 변경하고, 가능하면 ADMIN_BOOTSTRAP_* 환경변수를 제거하세요.'
  );
}

async function seedDefaultsPg(pool) {
  await seedSiteSettingsPg(pool);
  await ensureBootstrapAdminPg(pool);
}

/** SQLite: 사이트 기본값 + 관리자 부트스트랩 */
function seedDefaultsSqliteWrap(database) {
  seedSiteSettingsSqlite(database);
  ensureBootstrapAdminSqlite(database);
}

async function initializeDatabase() {
  if (usePostgres()) {
    await initializePostgres();
  } else {
    initializeSqliteSync();
    seedDefaultsSqliteWrap(getDb());
  }
  console.log('데이터베이스 초기화 완료');
}

module.exports = {
  getDb,
  getPool,
  getDataDir,
  usePostgres,
  initializeDatabase
};
