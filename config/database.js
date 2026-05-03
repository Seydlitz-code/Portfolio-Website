const Database = require('better-sqlite3');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

/**
 * 로컬: SQLite 파일 (<프로젝트>/data)
 * Railway 등: 환경변수 DATABASE_URL 이 있으면 PostgreSQL만 사용(영구 저장).
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
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT
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

  const userCols = database.prepare('PRAGMA table_info(users)').all();
  if (!userCols.some((c) => c.name === 'avatar')) {
    database.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
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
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT
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
  if (!(await pgColumnExists(pool, 'users', 'avatar'))) {
    await pool.query('ALTER TABLE users ADD COLUMN avatar TEXT');
  }

  await seedDefaultsPg(pool);

  console.log('[database] PostgreSQL 연결됨 (DATABASE_URL)');
}

function seedDefaults({ insertSetting, getAdmin, insertAdmin, run, get }) {
  const defaults = {
    site_name: 'Donghawan Lee / @lilip',
    bio: '',
    profile_image: '',
    all_posts_intro_ko: '작성된 모든 게시물을 확인할 수 있는 게시판 입니다.',
    all_posts_intro_ja: '作成された全ての投稿を確認できる掲示板です。'
  };

  for (const [key, value] of Object.entries(defaults)) {
    insertSetting(key, value);
  }

  if (!getAdmin()) {
    const hashedPassword = bcrypt.hashSync('renown0716**AA', 12);
    insertAdmin(hashedPassword);
    console.log('관리자 계정 생성 완료');
  }

  run("UPDATE users SET nickname = '릴리프' WHERE username = 'seydlitz'");
  run(
    "UPDATE users SET avatar = ? WHERE username = 'seydlitz' AND (avatar IS NULL OR TRIM(avatar) = '')",
    '/images/default-admin-avatar.png'
  );

  if (process.env.SYNC_SEED_ADMIN === '1' || process.env.SYNC_SEED_ADMIN === 'true') {
    const a = get("SELECT * FROM users WHERE username = 'seydlitz'");
    if (a) {
      const rehash = bcrypt.hashSync('renown0716**AA', 12);
      const isAdmin = Number(a.is_admin) === 1 || a.is_admin === true;
      const ok = bcrypt.compareSync('renown0716**AA', a.password) && isAdmin;
      if (!ok) {
        run(
          "UPDATE users SET password = ?, is_admin = 1, nickname = '릴리프' WHERE username = 'seydlitz'",
          rehash
        );
        console.log('SYNC_SEED_ADMIN: seydlitz 계정이 기본 문서와 동일하게 갱신되었습니다. 환경변수를 끄세요.');
      }
    }
  }
}

async function seedDefaultsPg(pool) {
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

  const adminExists = await pool.query('SELECT id FROM users WHERE username = $1', ['seydlitz']);
  if (adminExists.rows.length === 0) {
    const hashedPassword = bcrypt.hashSync('renown0716**AA', 12);
    await pool.query(
      `INSERT INTO users (username, nickname, password, is_admin, avatar) VALUES ($1, $2, $3, $4, $5)`,
      ['seydlitz', '릴리프', hashedPassword, 1, '/images/default-admin-avatar.png']
    );
    console.log('관리자 계정 생성 완료');
  }

  await pool.query("UPDATE users SET nickname = '릴리프' WHERE username = 'seydlitz'");
  await pool.query(
    "UPDATE users SET avatar = $1 WHERE username = 'seydlitz' AND (avatar IS NULL OR TRIM(avatar) = '')",
    ['/images/default-admin-avatar.png']
  );

  if (process.env.SYNC_SEED_ADMIN === '1' || process.env.SYNC_SEED_ADMIN === 'true') {
    const ar = await pool.query("SELECT * FROM users WHERE username = 'seydlitz'");
    const a = ar.rows[0];
    if (a) {
      const rehash = bcrypt.hashSync('renown0716**AA', 12);
      const isAdmin = Number(a.is_admin) === 1 || a.is_admin === true;
      const ok = bcrypt.compareSync('renown0716**AA', a.password) && isAdmin;
      if (!ok) {
        await pool.query(
          "UPDATE users SET password = $1, is_admin = 1, nickname = '릴리프' WHERE username = 'seydlitz'",
          [rehash]
        );
        console.log('SYNC_SEED_ADMIN: seydlitz 계정이 기본 문서와 동일하게 갱신되었습니다. 환경변수를 끄세요.');
      }
    }
  }
}

/** SQLite 기본 설정·관리자 시드 */
function seedDefaultsSqliteWrap(database) {
  seedDefaults({
    insertSetting: (k, v) =>
      database.prepare('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)').run(k, v),
    getAdmin: () => database.prepare('SELECT id FROM users WHERE username = ?').get('seydlitz'),
    insertAdmin: (hash) =>
      database
        .prepare(
          'INSERT INTO users (username, nickname, password, is_admin, avatar) VALUES (?, ?, ?, ?, ?)'
        )
        .run('seydlitz', '릴리프', hash, 1, '/images/default-admin-avatar.png'),
    run: (sql, ...args) => database.prepare(sql).run(...args),
    get: (sql, ...args) => database.prepare(sql).get(...args)
  });
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
