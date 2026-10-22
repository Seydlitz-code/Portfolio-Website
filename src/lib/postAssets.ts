/**
 * 게시물 본문 첨부(이미지·동영상) 관리 (기존 lib/postAssets.js 이식).
 * 파일은 R2, 메타데이터는 D1 post_body_assets에 있다. 지울 때는 둘 다 지운다.
 */
import type { Env } from '../types';
import { D1_MAX_BOUND_PARAMS } from './dbLimits';
import { NOW_SQL } from './time';

/** 업로드 후 게시물에 붙지 않은 파일을 지우기까지의 유예: 24시간 (작성 중인 글 보호) */
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

const ASSET_URL_PREFIX = '/media/post-body/';
const ASSET_REF_PATTERN = /\/media\/post-body\/(\d+)/g;
/** R2 일괄 삭제 한 번에 넘길 수 있는 최대 키 수 (R2 API 상한) */
const R2_DELETE_MAX_KEYS = 1000;

/**
 * table.column 텍스트 안에 현재 post_body_assets 행의 주소가 없다는 조건.
 * id 뒤가 숫자가 아니거나 문자열 끝인지 확인해, /media/post-body/7이 /media/post-body/70에 걸리지 않게 한다.
 */
function buildNotReferencedSql(table: string, column: string): string {
  const url = `'*${ASSET_URL_PREFIX}' || post_body_assets.id`;
  return `NOT EXISTS (SELECT 1 FROM ${table} WHERE ${column} GLOB (${url} || '[^0-9]*') OR ${column} GLOB (${url}))`;
}

/**
 * 첨부가 게시물 본문과 사이트 설정(자기소개 등) 어디에서도 참조되지 않는다는 조건.
 * 참조 확인을 D1 안에서 끝내, 모든 게시물 본문(수 MB가 될 수 있음)을 Worker로 읽어 오지 않는다.
 */
const UNREFERENCED_ASSET_SQL = `${buildNotReferencedSql('posts', 'posts.content')}
  AND ${buildNotReferencedSql('site_settings', 'site_settings.value')}`;

/** HTML에서 /media/post-body/:id 참조 id 집합 */
export function extractAssetIds(html: unknown): Set<number> {
  const ids = new Set<number>();
  for (const match of String(html ?? '').matchAll(ASSET_REF_PATTERN)) ids.add(Number(match[1]));
  return ids;
}

/**
 * ids를 D1 바인딩 상한(100개)씩 나눠 쿼리를 만든다. buildSql은 IN 자리표시자 문자열을 받아 SQL을 돌려준다.
 * 무료 플랜은 요청당 D1 쿼리 수에도 상한이 있어 id마다 쿼리를 만들지 않는다.
 */
function buildChunkedStatements(
  db: D1Database,
  ids: number[],
  buildSql: (placeholders: string) => string
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < ids.length; i += D1_MAX_BOUND_PARAMS) {
    const chunk = ids.slice(i, i + D1_MAX_BOUND_PARAMS);
    statements.push(db.prepare(buildSql(chunk.map(() => '?').join(', '))).bind(...chunk));
  }
  return statements;
}

/**
 * 저장하는 HTML이 참조하는 첨부를 "붙음"(attached_at)으로 표시하는 쿼리.
 * 게시물·사이트 설정을 저장하는 batch에 함께 넣는다. 붙은 첨부는 Cron 정리가 다시 검사하지 않는다.
 */
export function buildMarkAttachedStatements(db: D1Database, html: string): D1PreparedStatement[] {
  return buildChunkedStatements(
    db,
    [...extractAssetIds(html)],
    (placeholders) => `UPDATE post_body_assets SET attached_at = ${NOW_SQL} WHERE attached_at IS NULL AND id IN (${placeholders})`
  );
}

/** DELETE … RETURNING r2_key 결과에서 R2 키를 모아 R2 파일을 지운다. 지운 개수를 돌려준다. */
async function deleteR2Files(env: Env, results: D1Result<unknown>[]): Promise<number> {
  const keys = results.flatMap((result) => (result.results as { r2_key: string }[]).map((row) => row.r2_key));
  // R2 일괄 삭제는 한 번에 최대 1000개라 나눠서 보낸다.
  for (let i = 0; i < keys.length; i += R2_DELETE_MAX_KEYS) {
    await env.MEDIA.delete(keys.slice(i, i + R2_DELETE_MAX_KEYS));
  }
  return keys.length;
}

/**
 * 후보 중 어디에서도 참조되지 않는 첨부만 삭제한다.
 * beforeStatements(게시물 수정·삭제 쿼리 등)를 주면 같은 batch 맨 앞에서 먼저 실행한 뒤 참조를 확인한다.
 * batch는 순서대로 실행되므로 참조 확인은 수정·삭제가 반영된 상태를 본다.
 */
export async function deleteAssetsIfUnreferenced(
  env: Env,
  candidateIds: Iterable<number>,
  beforeStatements: D1PreparedStatement[] = []
): Promise<number> {
  const db = env.DB;
  const candidates = [...candidateIds].filter((id) => Number.isInteger(id) && id > 0);
  const deleteStatements = buildChunkedStatements(
    db,
    candidates,
    (placeholders) => `DELETE FROM post_body_assets WHERE id IN (${placeholders}) AND ${UNREFERENCED_ASSET_SQL} RETURNING r2_key`
  );
  if (!beforeStatements.length && !deleteStatements.length) return 0;
  const results = await db.batch([...beforeStatements, ...deleteStatements]);
  return deleteR2Files(env, results.slice(beforeStatements.length));
}

/**
 * 유예 시간이 지난 미참조 첨부 정리 (Cron).
 * 한 번도 붙지 않은(attached_at IS NULL) 첨부만 검사하므로, 검사 비용은 버려진 업로드 수에만 비례한다.
 * 붙었다가 빠진 첨부는 게시물 수정·삭제 때 deleteAssetsIfUnreferenced가 정리한다.
 * beforeStatements를 주면 같은 batch 맨 앞에서 먼저 실행한다 (Cron의 다른 정리 작업과 D1 왕복을 합치기 위함).
 */
export async function sweepOrphanAssets(
  env: Env,
  now = Date.now(),
  beforeStatements: D1PreparedStatement[] = []
): Promise<number> {
  const db = env.DB;
  // created_at은 NOW_SQL과 같은 ISO 8601 UTC 형식이라 문자열 비교로 시각을 비교할 수 있다.
  const cutoffIso = new Date(now - ORPHAN_GRACE_MS).toISOString();
  const results = await db.batch([
    ...beforeStatements,
    db
      .prepare(
        `DELETE FROM post_body_assets
          WHERE attached_at IS NULL AND created_at <= ? AND ${UNREFERENCED_ASSET_SQL}
          RETURNING r2_key`
      )
      .bind(cutoffIso)
  ]);
  const removed = await deleteR2Files(env, results.slice(beforeStatements.length));
  if (removed) console.log(`[assets] 미참조 첨부 ${removed}건 정리`);
  return removed;
}
