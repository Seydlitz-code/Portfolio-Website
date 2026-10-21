/** 관리자: 메인 페이지 설정·게시판 관리 (기존 routes/admin.js 이식) */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { field, fileField, fileHead, readForm, requireAdmin, type FormBody } from '../lib/http';
import { parseId } from '../lib/ids';
import { sanitizeBioHtml, sanitizePostHtml, stripHtmlToPlain } from '../lib/html';
import { KIND_SITE_PROFILE_IMAGE, SITE_PROFILE_IMAGE_URL, upsertSiteSetting } from '../lib/siteData';
import { IMAGE_MIMES, verifiedMime } from '../lib/fileSniff';
import { renderMainSettings } from './mypage';

const PROFILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_ONLY = '이미지 파일(JPG, PNG, GIF, WEBP)만 업로드 가능합니다.';

const admin = new Hono<AppEnv>();
admin.use('*', requireAdmin);

/** 메인 화면 프로필 이미지를 R2에 저장하고 이전 파일은 지운다. */
async function saveSiteProfileImage(c: Context<AppEnv>, file: File, mime: string) {
  const db = c.env.DB;
  const prev = await db.prepare('SELECT r2_key FROM site_assets WHERE kind = ?').bind(KIND_SITE_PROFILE_IMAGE).first<{ r2_key: string }>();
  const key = `site/profile-image/${crypto.randomUUID()}`;
  await c.env.MEDIA.put(key, file, { httpMetadata: { contentType: mime } });
  await db.batch([
    db
      .prepare(
        `INSERT INTO site_assets (kind, r2_key, mime) VALUES (?, ?, ?)
         ON CONFLICT (kind) DO UPDATE SET r2_key = excluded.r2_key, mime = excluded.mime`
      )
      .bind(KIND_SITE_PROFILE_IMAGE, key, mime),
    db
      .prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .bind('profile_image', SITE_PROFILE_IMAGE_URL)
  ]);
  if (prev?.r2_key) await c.env.MEDIA.delete(prev.r2_key);
}

/** 업로드된 이미지 확인. 문제가 있으면 오류 문구를 돌려준다. */
async function checkImage(file: File | null): Promise<{ mime: string | null; error: string | null }> {
  if (!file) return { mime: null, error: null };
  if (file.size > PROFILE_IMAGE_MAX_BYTES) return { mime: null, error: '이미지는 5MB 이하여야 합니다.' };
  const mime = verifiedMime(await fileHead(file), IMAGE_MIMES);
  return mime ? { mime, error: null } : { mime: null, error: IMAGE_ONLY };
}

/** site_name·bio 저장. 사이트 이름이 비면 오류 문구를 돌려준다. */
async function saveTexts(c: Context<AppEnv>, body: FormBody, trimName: boolean): Promise<string | null> {
  const siteName = field(body, 'site_name');
  const bio = field(body, 'bio');
  if (siteName != null) {
    const sanitized = await sanitizePostHtml(trimName ? siteName.trim() : siteName);
    if (!stripHtmlToPlain(sanitized).length) return '메인 페이지 표기 이름은 비워둘 수 없습니다.';
    await upsertSiteSetting(c.env.DB, 'site_name', sanitized);
  }
  if (bio != null) await upsertSiteSetting(c.env.DB, 'bio', await sanitizeBioHtml(bio.trim()));
  return null;
}

admin.get('/mypage', (c) => c.redirect('/mypage/main-settings'));

/** 마이페이지 '메인 페이지 설정'의 적용하기 */
admin.post('/apply', async (c) => {
  if (Number(c.req.header('content-length') || '0') > PROFILE_IMAGE_MAX_BYTES + 1024 * 1024) {
    return renderMainSettings(c, 400, { errMessage: '이미지는 5MB 이하여야 합니다.' });
  }
  const body = await readForm(c);
  const file = fileField(body, 'profile_image');
  const img = await checkImage(file);
  if (img.error) return renderMainSettings(c, 400, { errMessage: img.error });
  const textErr = await saveTexts(c, body, true);
  if (textErr) return renderMainSettings(c, 400, { errMessage: textErr });
  if (file && img.mime) await saveSiteProfileImage(c, file, img.mime);
  return c.redirect('/mypage/main-settings?saved=1');
});

admin.post('/settings', async (c) => {
  const err = await saveTexts(c, await readForm(c), false);
  if (err) return c.text(err, 400);
  return c.redirect('/mypage/main-settings?saved=1');
});

admin.post('/profile-image', async (c) => {
  const body = await readForm(c);
  const file = fileField(body, 'profile_image');
  if (!file) return c.redirect('/mypage/main-settings');
  const img = await checkImage(file);
  if (img.error || !img.mime) return c.text(img.error ?? IMAGE_ONLY, 400);
  await saveSiteProfileImage(c, file, img.mime);
  return c.redirect('/mypage/main-settings?saved=1');
});

function boardFields(body: FormBody) {
  return {
    name: (field(body, 'name') ?? '').trim(),
    nameJa: (field(body, 'name_ja') ?? '').trim(),
    description: (field(body, 'description') ?? '').trim()
  };
}

admin.post('/projects', async (c) => {
  const { name, nameJa, description } = boardFields(await readForm(c));
  if (!name || !nameJa || !description) return c.redirect('/mypage/boards?createErr=1');
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
  const { name, nameJa, description } = boardFields(await readForm(c));
  if (!name || !nameJa || !description) return c.redirect('/mypage/boards?editErr=1');
  const r = await c.env.DB.prepare('UPDATE projects SET name = ?, name_ja = ?, description = ? WHERE id = ?')
    .bind(name, nameJa, description, id)
    .run();
  if (!r.meta.changes) return c.redirect('/mypage/boards?editErr=1');
  return c.redirect('/mypage/boards?editSaved=1');
});

admin.delete('/projects/:id', async (c) => {
  const id = parseId(c.req.param('id'));
  if (id == null) return c.redirect('/mypage/boards');
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM posts WHERE project_id = ?').bind(id).first<{ n: number }>();
  if (Number(row?.n ?? 0) > 0) return c.redirect('/mypage/boards?deleteBlocked=1');
  await c.env.DB.prepare('DELETE FROM projects WHERE id = ?').bind(id).run();
  return c.redirect('/mypage/boards?deleted=1');
});

export default admin;
