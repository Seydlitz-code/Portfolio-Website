/**
 * SQLite(better-sqlite3) 또는 PostgreSQL(Railway DATABASE_URL) 공통 비동기 쿼리.
 * SQL은 SQLite 스타일 플레이스홀더(?)를 사용합니다.
 */
const { getDb, getPool, usePostgres } = require('../config/database');

function toPg(sql, params) {
  const values = params != null ? [...params] : [];
  let i = 0;
  const text = sql.replace(/\?/g, () => {
    i += 1;
    return `$${i}`;
  });
  if (i !== values.length) {
    throw new Error(`[db] 플레이스홀더 개수(${i})와 인자 개수(${values.length})가 맞지 않습니다.`);
  }
  return [text, values];
}

function insertTableName(sql) {
  const m = String(sql).match(/^\s*INSERT\s+INTO\s+"?(\w+)"?\s+/i);
  return m ? m[1].toLowerCase() : '';
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 */
async function get(sql, params = []) {
  if (usePostgres()) {
    const pool = getPool();
    const [text, vals] = toPg(sql, params);
    const res = await pool.query(text, vals);
    return res.rows[0] || null;
  }
  return getDb().prepare(sql).get(...params);
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 */
async function all(sql, params = []) {
  if (usePostgres()) {
    const pool = getPool();
    const [text, vals] = toPg(sql, params);
    const res = await pool.query(text, vals);
    return res.rows;
  }
  return getDb().prepare(sql).all(...params);
}

/**
 * INSERT/UPDATE/DELETE. INSERT 시 SERIAL id가 있으면 lastInsertRowid에 반환.
 * @param {string} sql
 * @param {unknown[]} [params]
 */
async function run(sql, params = []) {
  if (usePostgres()) {
    const pool = getPool();
    let [text, vals] = toPg(sql, params);
    const isInsert = /^\s*INSERT\s+/i.test(sql) && !/RETURNING/i.test(sql);
    const tbl = insertTableName(sql);
    if (isInsert && ['posts', 'projects', 'comments', 'users'].includes(tbl)) {
      text = `${text.replace(/;?\s*$/u, '')} RETURNING id`;
    }
    const res = await pool.query(text, vals);
    const id = res.rows[0] && res.rows[0].id != null ? Number(res.rows[0].id) : undefined;
    return { changes: res.rowCount, lastInsertRowid: id };
  }
  return getDb().prepare(sql).run(...params);
}

async function upsertSiteSetting(key, value) {
  if (usePostgres()) {
    await getPool().query(
      `INSERT INTO site_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    );
  } else {
    getDb().prepare('INSERT OR REPLACE INTO site_settings (key, value) VALUES (?, ?)').run(key, value);
  }
}

module.exports = { get, all, run, upsertSiteSetting, usePostgres };
