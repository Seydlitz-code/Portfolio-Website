/**
 * 미참조 본문 첨부 정리(lib/postAssets.js)를 앱 모듈로 직접 검증.
 * 앱 모듈은 require 시점의 환경변수로 DB를 고르므로, 환경을 먼저 설정한 뒤 불러온다.
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { freshDbEnv, usingPostgres } = require('../helpers');

let db;
let sweepOrphanAssets;
let deleteAssetsIfUnreferenced;

before(async () => {
  const env = await freshDbEnv();
  ['DATABASE_URL', 'DATA_DIR', 'NODE_ENV', 'RAILWAY_ENVIRONMENT_NAME', 'RENDER'].forEach((k) => delete process.env[k]);
  Object.assign(process.env, env);
  const { initializeDatabase } = require('../../config/database');
  await initializeDatabase();
  db = require('../../lib/db');
  ({ sweepOrphanAssets, deleteAssetsIfUnreferenced } = require('../../lib/postAssets'));
});

after(async () => {
  if (usingPostgres()) await require('../../config/database').getPool().end();
});

/** created_at을 지정 시간 전으로 둔 첨부 삽입 → id */
async function insertAsset(hoursAgo) {
  const data = Buffer.from('asset');
  if (usingPostgres()) {
    const r = await db.get(
      "INSERT INTO post_body_assets (mime, data, created_at) VALUES ('image/png', ?, NOW() - (? || ' hours')::interval) RETURNING id",
      [data, String(hoursAgo)]
    );
    return Number(r.id);
  }
  const r = await db.run("INSERT INTO post_body_assets (mime, data, created_at) VALUES ('image/png', ?, datetime('now', ?))", [
    data,
    `-${hoursAgo} hours`
  ]);
  return Number(r.lastInsertRowid);
}

async function exists(id) {
  return Boolean(await db.get('SELECT id FROM post_body_assets WHERE id = ?', [id]));
}

describe('미참조 첨부 정리', () => {
  it('24시간 지난 미참조만 삭제, 참조 중·유예 중은 유지', async () => {
    const oldOrphan = await insertAsset(48);
    const oldReferenced = await insertAsset(48);
    const freshOrphan = await insertAsset(1);
    await db.run('INSERT INTO posts (title, content) VALUES (?, ?)', ['ref', `<img src="/media/post-body/${oldReferenced}">`]);

    const removed = await sweepOrphanAssets();
    assert.equal(removed, 1);
    assert.equal(await exists(oldOrphan), false);
    assert.equal(await exists(oldReferenced), true);
    assert.equal(await exists(freshOrphan), true);
  });

  it('사이트 설정(자기소개)에서 참조 중인 첨부는 유지', async () => {
    const id = await insertAsset(48);
    await db.upsertSiteSetting('bio', `<p><img src="/media/post-body/${id}"></p>`);
    await sweepOrphanAssets();
    assert.equal(await exists(id), true);
  });

  it('후보 삭제: 다른 게시물이 쓰는 첨부는 남김', async () => {
    const shared = await insertAsset(0);
    const lonely = await insertAsset(0);
    await db.run('INSERT INTO posts (title, content) VALUES (?, ?)', ['other', `<img src="/media/post-body/${shared}">`]);
    const removed = await deleteAssetsIfUnreferenced(new Set([shared, lonely]));
    assert.equal(removed, 1);
    assert.equal(await exists(shared), true);
    assert.equal(await exists(lonely), false);
  });

  it('id 경계: /media/post-body/N 참조가 N으로 시작하는 다른 id(N0 등)를 지키지 않음', async () => {
    const short = 7000;
    const long = 70001;
    for (const id of [short, long]) {
      await db.run('INSERT INTO post_body_assets (id, mime, data, created_at) VALUES (?, ?, ?, ?)', [
        id,
        'image/png',
        Buffer.from('asset'),
        '2000-01-01 00:00:00'
      ]);
    }
    await db.run('INSERT INTO posts (title, content) VALUES (?, ?)', ['edge', `<img src="/media/post-body/${short}">`]);
    await sweepOrphanAssets();
    assert.equal(await exists(short), true);
    assert.equal(await exists(long), false);
  });
});
