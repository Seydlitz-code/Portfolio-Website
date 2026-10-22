/** 관리자: 메인 페이지 설정·게시판 관리 (기존 routes/admin.js 이식) */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { isFormBodyTooLarge, readField, readFileField, readForm, requireAdmin, type FormBody } from '../lib/http';
import { parseId } from '../lib/ids';
import { sanitizeBioHtml, sanitizePostHtml, SETTING_HTML_MAX_CHARS, stripHtmlToPlain } from '../lib/html';
import { KIND_SITE_PROFILE_IMAGE, SITE_PROFILE_IMAGE_URL, UPSERT_SETTING_SQL } from '../lib/siteData';
import { checkImageFile, SITE_PROFILE_IMAGE_RULE } from '../lib/imageCheck';
import { renderMainSettings } from '../lib/mypagePages';
import { buildMarkAttachedStatements, deleteAssetsIfUnreferenced, extractAssetIds } from '../lib/postAssets';

/** 사이트 이름·자기소개가 SETTING_HTML_MAX_CHARS(64K자)를 넘을 때 안내 */
const SETTING_TOO_LARGE_MESSAGE = '내용이 너무 깁니다 (최대 약 6만 자). 붙여 넣은 이미지는 빼고 다시 저장해주세요.';
/** 본문 첨부 주소가 들어갈 수 있는 사이트 설정 항목 */
const SETTING_HTML_KEYS = ['site_name', 'bio'] as const;

const admin = new Hono<AppEnv>();
admin.use('*', requireAdmin);

/**
 * 메인 화면 프로필 이미지를 R2에 저장하고 이전 파일은 지운다.
 * extraStatements(사이트 이름·자기소개 저장 등)를 주면 같은 batch로 함께 보내고, 그 결과를 순서대로 돌려준다.
 */
async function saveSiteProfileImage(
  c: Context<AppEnv>,
  file: File,
  mime: string,
  extraStatements: D1PreparedStatement[] = []
): Promise<D1Result<unknown>[]> {
  const db = c.env.DB;
  const key = `site/profile-image/${crypto.randomUUID()}`;
  await c.env.MEDIA.put(key, file, { httpMetadata: { contentType: mime } });
  // 옛 키 조회와 새 키 저장을 한 번에 보낸다. batch는 순서대로 실행되므로 SELECT는 바꾸기 전 값을 읽는다.
  const results = await db.batch([
    db.prepare('SELECT r2_key FROM site_assets WHERE kind = ?').bind(KIND_SITE_PROFILE_IMAGE),
    db
      .prepare(
        `INSERT INTO site_assets (kind, r2_key, mime) VALUES (?, ?, ?)
         ON CONFLICT (kind) DO UPDATE SET r2_key = excluded.r2_key, mime = excluded.mime`
      )
      .bind(KIND_SITE_PROFILE_IMAGE, key, mime),
    db.prepare(UPSERT_SETTING_SQL).bind('profile_image', SITE_PROFILE_IMAGE_URL),
    ...extraStatements
  ]);
  const previousKey = (results[0].results[0] as { r2_key: string } | undefined)?.r2_key;
  // 바꿔치기된 옛 파일 삭제는 응답을 늦출 필요가 없어 응답 뒤에 처리한다.
  if (previousKey) c.executionCtx.waitUntil(c.env.MEDIA.delete(previousKey));
  return results.slice(results.length - extraStatements.length);
}

/**
 * site_name·bio를 정제해 저장 쿼리를 만든다 (보내지는 않음 — 다른 쿼리와 한 번에 보내기 위해).
 * keptAssetIds는 새 값이 참조하는 본문 첨부 id다. 사이트 이름이 비거나 너무 길면 쿼리 대신 오류 문구를 돌려준다.
 */
async function buildSiteTextStatements(
  c: Context<AppEnv>,
  body: FormBody
): Promise<{ error: string } | { statements: D1PreparedStatement[]; keptAssetIds: Set<number> }> {
  const db = c.env.DB;
  const siteName = readField(body, 'site_name');
  const bio = readField(body, 'bio');
  const statements: D1PreparedStatement[] = [];
  const keptAssetIds = new Set<number>();
  const addSetting = (key: (typeof SETTING_HTML_KEYS)[number], html: string) => {
    statements.push(db.prepare(UPSERT_SETTING_SQL).bind(key, html), ...buildMarkAttachedStatements(db, html));
    extractAssetIds(html).forEach((assetId) => keptAssetIds.add(assetId));
  };
  if (siteName != null) {
    const sanitizedName = await sanitizePostHtml(siteName.trim());
    if (!stripHtmlToPlain(sanitizedName).length) return { error: '메인 페이지 표기 이름은 비워둘 수 없습니다.' };
    if (sanitizedName.length > SETTING_HTML_MAX_CHARS) return { error: SETTING_TOO_LARGE_MESSAGE };
    addSetting('site_name', sanitizedName);
  }
  if (bio != null) {
    const sanitizedBio = await sanitizeBioHtml(bio.trim());
    if (sanitizedBio.length > SETTING_HTML_MAX_CHARS) return { error: SETTING_TOO_LARGE_MESSAGE };
    addSetting('bio', sanitizedBio);
  }
  return { statements, keptAssetIds };
}

/**
 * 지금 저장된 site_name·bio를 읽는 쿼리. 저장 쿼리보다 앞에 두면 batch 순서상 바꾸기 전 값을 읽는다
 * (저장 뒤 빠진 첨부를 찾기 위함).
 */
function buildSettingHtmlStatement(db: D1Database): D1PreparedStatement {
  const placeholders = SETTING_HTML_KEYS.map(() => '?').join(', ');
  return db.prepare(`SELECT value FROM site_settings WHERE key IN (${placeholders})`).bind(...SETTING_HTML_KEYS);
}

/** 설정 값 행들이 참조하는 본문 첨부 id */
function collectSettingAssetIds(result: D1Result<unknown>): Set<number> {
  const ids = new Set<number>();
  for (const row of result.results as { value: string | null }[]) extractAssetIds(row.value).forEach((assetId) => ids.add(assetId));
  return ids;
}

// 기존 주소 호환: 예전 관리자 화면 주소(/admin/mypage)로 들어오면 새 메인 설정 화면으로 보낸다.
admin.get('/mypage', (c) => c.redirect('/mypage/main-settings'));

/** 마이페이지 '메인 페이지 설정'의 적용하기 (사이트 이름·자기소개·프로필 이미지를 함께 저장) */
admin.post('/apply', async (c) => {
  if (isFormBodyTooLarge(c, SITE_PROFILE_IMAGE_RULE.maxBytes)) {
    return renderMainSettings(c, 400, { errorMessage: SITE_PROFILE_IMAGE_RULE.tooLargeMessage });
  }
  const body = await readForm(c);
  const file = readFileField(body, 'profile_image');
  const image = file ? await checkImageFile(file, SITE_PROFILE_IMAGE_RULE) : null;
  if (image && 'error' in image) return renderMainSettings(c, 400, { errorMessage: image.error });
  const texts = await buildSiteTextStatements(c, body);
  if ('error' in texts) return renderMainSettings(c, 400, { errorMessage: texts.error });
  // 옛 값 조회와 이름·자기소개 저장을 (이미지가 있으면 이미지 저장과도) 한 batch로 보낸다.
  const statements = [buildSettingHtmlStatement(c.env.DB), ...texts.statements];
  const [previousSettingsRes] = file && image
    ? await saveSiteProfileImage(c, file, image.mime, statements)
    : await c.env.DB.batch(statements);
  // 이름·자기소개에서 빠진 첨부는 어디에서도 참조되지 않으면 지운다 (Cron은 한 번 붙은 첨부를 다시 보지 않음).
  const droppedAssetIds = [...collectSettingAssetIds(previousSettingsRes)].filter((assetId) => !texts.keptAssetIds.has(assetId));
  if (droppedAssetIds.length) await deleteAssetsIfUnreferenced(c.env, droppedAssetIds);
  return c.redirect('/mypage/main-settings?saved=1');
});

function readBoardFields(body: FormBody) {
  return {
    name: (readField(body, 'name') ?? '').trim(),
    nameJa: (readField(body, 'name_ja') ?? '').trim(),
    description: (readField(body, 'description') ?? '').trim()
  };
}

admin.post('/projects', async (c) => {
  const { name, nameJa, description } = readBoardFields(await readForm(c));
  if (!name || !nameJa || !description) return c.redirect('/mypage/boards?createErr=1');
  // 새 게시판은 정렬 순서 맨 뒤에 붙인다.
  await c.env.DB.prepare(
    'INSERT INTO projects (name, name_ja, description, order_num) VALUES (?, ?, ?, (SELECT COALESCE(MAX(order_num), 0) + 1 FROM projects))'
  )
    .bind(name, nameJa, description)
    .run();
  return c.redirect('/mypage/boards?saved=1');
});

admin.put('/projects/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id == null) return c.redirect('/mypage/boards?editErr=1');
  const { name, nameJa, description } = readBoardFields(await readForm(c));
  if (!name || !nameJa || !description) return c.redirect('/mypage/boards?editErr=1');
  const result = await c.env.DB.prepare('UPDATE projects SET name = ?, name_ja = ?, description = ? WHERE id = ?')
    .bind(name, nameJa, description, id)
    .run();
  if (!result.meta.changes) return c.redirect('/mypage/boards?editErr=1');
  return c.redirect('/mypage/boards?editSaved=1');
});

admin.delete('/projects/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id == null) return c.redirect('/mypage/boards');
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS count FROM posts WHERE project_id = ?').bind(id).first<{ count: number }>();
  if (Number(row?.count ?? 0) > 0) return c.redirect('/mypage/boards?deleteBlocked=1');
  await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
  return c.redirect('/mypage/boards?deleted=1');
});

export default admin;
