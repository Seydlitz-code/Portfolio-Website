const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

/**
 * SQLite 및 세션 파일을 저장하는 디렉터리.
 * - 로컬: <프로젝트>/data
 * - Render: 영구 디스크를 /data 등에 마운트한 뒤 env DATA_DIR과 동일하게 설정
 * 주의: 디스크를 "db" 폴더에 마운트하면 db/database.js 코드가 사라지므로 사용하지 말 것.
 */
function getDataDir() {
  if (process.env.DATA_DIR) {
    return process.env.DATA_DIR;
  }
  return path.join(__dirname, '..', 'data');
}

const DB_FILE = 'portfolio.db';
let db;

function getDb() {
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

function initializeDatabase() {
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

  const userCols = database.prepare('PRAGMA table_info(users)').all();
  if (!userCols.some((c) => c.name === 'avatar')) {
    database.exec('ALTER TABLE users ADD COLUMN avatar TEXT');
  }

  const defaults = {
    site_name: 'Donghawan Lee / @lilip',
    bio: '',
    profile_image: ''
  };

  const insertSetting = database.prepare(
    'INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)'
  );
  for (const [key, value] of Object.entries(defaults)) {
    insertSetting.run(key, value);
  }

  const adminExists = database.prepare(
    'SELECT id FROM users WHERE username = ?'
  ).get('seydlitz');

  if (!adminExists) {
    const hashedPassword = bcrypt.hashSync('renown0716**AA', 12);
    database.prepare(
      'INSERT INTO users (username, nickname, password, is_admin, avatar) VALUES (?, ?, ?, ?, ?)'
    ).run('seydlitz', '릴리프', hashedPassword, 1, '/images/default-admin-avatar.png');
    console.log('관리자 계정 생성 완료');
  }
  database.prepare("UPDATE users SET nickname = '릴리프' WHERE username = 'seydlitz'").run();
  database
    .prepare(
      "UPDATE users SET avatar = ? WHERE username = 'seydlitz' AND (avatar IS NULL OR TRIM(avatar) = '')"
    )
    .run('/images/default-admin-avatar.png');

  if (process.env.SYNC_SEED_ADMIN === '1' || process.env.SYNC_SEED_ADMIN === 'true') {
    const a = database.prepare("SELECT * FROM users WHERE username = 'seydlitz'").get();
    if (a) {
      const rehash = bcrypt.hashSync('renown0716**AA', 12);
      const isAdmin = Number(a.is_admin) === 1 || a.is_admin === true;
      const ok = bcrypt.compareSync('renown0716**AA', a.password) && isAdmin;
      if (!ok) {
        database.prepare(
          "UPDATE users SET password = ?, is_admin = 1, nickname = '릴리프' WHERE username = 'seydlitz'"
        ).run(rehash);
        console.log('SYNC_SEED_ADMIN: seydlitz 계정이 기본 문서와 동일하게 갱신되었습니다. 환경변수를 끄세요.');
      }
    }
  }

  console.log('데이터베이스 초기화 완료');
}

module.exports = { getDb, initializeDatabase, getDataDir };
