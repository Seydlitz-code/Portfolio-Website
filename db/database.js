const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname);
const DB_PATH = path.join(DB_DIR, 'portfolio.db');

let db;

function getDb() {
  if (!db) {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
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
      'INSERT INTO users (username, nickname, password, is_admin) VALUES (?, ?, ?, ?)'
    ).run('seydlitz', '릴리프 야', hashedPassword, 1);
    console.log('관리자 계정 생성 완료');
  }

  console.log('데이터베이스 초기화 완료');
}

module.exports = { getDb, initializeDatabase };
