/**
 * 게시물 본문 첨부(이미지·동영상) 관리 (기존 lib/postAssets.js 이식).
 * 파일은 R2, 메타데이터는 D1 post_body_assets에 있다. 지울 때는 둘 다 지운다.
 */
import type { Env } from '../types';
import { parseDbTime } from './time';

/** 업로드 후 게시물에 붙지 않은 파일을 지우기까지의 유예 (작성 중인 글 보호) */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

const ASSET_REF_RE = /\/media\/post-body\/(\d+)/g;

/** HTML에서 /media/post-body/:id 참조 id 집합 */
export function extractAssetIds(html: unknown): Set<number> {
  const ids = new Set<number>();
  for (const m of String(html ?? '').matchAll(ASSET_REF_RE)) ids.add(Number(m[1]));
  return ids;
}

/** 게시물 본문·사이트 설정(자기소개 등)이 참조 중인 첨부 id 전체 */
async function collectReferencedAssetIds(db: D1Database): Promise<Set<number>> {
  const [posts, settings] = await db.batch<{ v: string | null }>([
    db.prepare('SELECT content AS v FROM posts'),
    db.prepare('SELECT value AS v FROM site_settings')
  ]);
  const ids = new Set<number>();
  for (const r of [...posts.results, ...settings.results]) extractAssetIds(r.v).forEach((id) => ids.add(id));
  return ids;
}

async function deleteAsset(env: Env, id: number): Promise<number> {
  const row = await env.DB.prepare('DELETE FROM post_body_assets WHERE id = ? RETURNING r2_key')
    .bind(id)
    .first<{ r2_key: string }>();
  if (!row) return 0;
  await env.MEDIA.delete(row.r2_key);
  return 1;
}

/** 후보 중 어디에서도 참조되지 않는 첨부만 삭제 */
export async function deleteAssetsIfUnreferenced(env: Env, candidateIds: Iterable<number>): Promise<number> {
  const candidates = [...candidateIds].filter((id) => Number.isInteger(id) && id > 0);
  if (!candidates.length) return 0;
  const referenced = await collectReferencedAssetIds(env.DB);
  let removed = 0;
  for (const id of candidates) {
    if (!referenced.has(id)) removed += await deleteAsset(env, id);
  }
  return removed;
}

/** 유예 시간이 지난 미참조 첨부 정리 (Cron) */
export async function sweepOrphanAssets(env: Env, now = Date.now()): Promise<number> {
  const { results } = await env.DB.prepare('SELECT id, created_at FROM post_body_assets').all<{
    id: number;
    created_at: string;
  }>();
  if (!results.length) return 0;
  const referenced = await collectReferencedAssetIds(env.DB);
  let removed = 0;
  for (const row of results) {
    if (referenced.has(row.id)) continue;
    const created = parseDbTime(row.created_at);
    if (created && now - created.getTime() < ORPHAN_GRACE_MS) continue;
    removed += await deleteAsset(env, row.id);
  }
  if (removed) console.log(`[assets] 미참조 첨부 ${removed}건 정리`);
  return removed;
}
