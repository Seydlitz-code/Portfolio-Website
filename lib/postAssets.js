const db = require('./db');
const { parseDbTime } = require('./listingHelpers');

/** 업로드 후 게시물에 붙지 않은 파일을 지우기까지의 유예 (작성 중인 글 보호) */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const ASSET_REF_RE = /\/media\/post-body\/(\d+)/g;

/** HTML에서 /media/post-body/:id 참조 id 집합 */
function extractAssetIds(html) {
  const ids = new Set();
  const s = String(html || '');
  let m;
  ASSET_REF_RE.lastIndex = 0;
  while ((m = ASSET_REF_RE.exec(s)) !== null) {
    ids.add(Number(m[1]));
  }
  return ids;
}

/** 게시물 본문·사이트 설정(자기소개 등)이 참조 중인 첨부 id 전체 */
async function collectReferencedAssetIds() {
  const ids = new Set();
  const posts = await db.all('SELECT content FROM posts');
  posts.forEach((p) => extractAssetIds(p.content).forEach((id) => ids.add(id)));
  const settings = await db.all('SELECT value FROM site_settings');
  settings.forEach((r) => extractAssetIds(r.value).forEach((id) => ids.add(id)));
  return ids;
}

/** 후보 중 어디에서도 참조되지 않는 첨부만 삭제 */
async function deleteAssetsIfUnreferenced(candidateIds) {
  const candidates = [...candidateIds].filter((id) => Number.isInteger(id) && id > 0);
  if (!candidates.length) return 0;
  const referenced = await collectReferencedAssetIds();
  let removed = 0;
  for (const id of candidates) {
    if (referenced.has(id)) continue;
    const r = await db.run('DELETE FROM post_body_assets WHERE id = ?', [id]);
    removed += r && r.changes ? Number(r.changes) : 0;
  }
  return removed;
}

/** 유예 시간이 지난 미참조 첨부 정리 */
async function sweepOrphanAssets() {
  const rows = await db.all('SELECT id, created_at FROM post_body_assets');
  if (!rows.length) return 0;
  const referenced = await collectReferencedAssetIds();
  const now = Date.now();
  let removed = 0;
  for (const row of rows) {
    const id = Number(row.id);
    if (referenced.has(id)) continue;
    const created = parseDbTime(row.created_at);
    if (created && now - created.getTime() < ORPHAN_GRACE_MS) continue;
    const r = await db.run('DELETE FROM post_body_assets WHERE id = ?', [id]);
    removed += r && r.changes ? Number(r.changes) : 0;
  }
  if (removed) console.log(`[assets] 미참조 첨부 ${removed}건 정리`);
  return removed;
}

function startOrphanAssetSweeper() {
  const run = () => {
    sweepOrphanAssets().catch((e) => console.error('[assets] 정리 실패:', e.message));
  };
  const first = setTimeout(run, 60 * 1000);
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  if (typeof first.unref === 'function') first.unref();
  if (typeof timer.unref === 'function') timer.unref();
}

module.exports = {
  extractAssetIds,
  deleteAssetsIfUnreferenced,
  sweepOrphanAssets,
  startOrphanAssetSweeper
};
