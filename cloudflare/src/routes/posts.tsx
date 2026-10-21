/** 게시물·댓글 (기존 routes/posts.js 이식) */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { PostFormPage, PostPage, type CommentView, type PostDetail, type PostFormProps } from '../views/post';
import { AllPostsPage } from '../views/lists';
import { field, fileField, fileHead, navData, readForm, renderError, requireAdmin, requireLogin, type FormBody } from '../lib/http';
import { parseId } from '../lib/ids';
import { getSiteSettings, enrichListPostRow, POST_GLOBAL_NUM_JOIN, type PostRow, type Project } from '../lib/siteData';
import {
  buildPaginationItems,
  formatCommentDateTime,
  formatListTime,
  isEditedAfterCreate,
  LIST_BOARD_NAME_ALL_POSTS_MAX,
  NOW_SQL,
  pageParam,
  toIsoUtc
} from '../lib/time';
import { isPostContentMeaningful, plainTextToHtml, postContentLooksLikeHtml, sanitizePostHtml } from '../lib/html';
import { deleteAssetsIfUnreferenced, extractAssetIds } from '../lib/postAssets';
import { createCommentNotification } from '../lib/commentNotifications';
import { sanitizeMypageWritingsNext } from '../lib/mypageWritings';
import { IMAGE_MIMES, VIDEO_MIMES, verifiedMime } from '../lib/fileSniff';
import { clientIp } from '../lib/security';
import * as rate from '../lib/rateLimit';

const ALL_POSTS_PAGE_SIZE = 200;
const BODY_UPLOAD_MAX_BYTES = 55 * 1024 * 1024;
const POST_NOT_FOUND = '게시물을 찾을 수 없습니다.';
const DEFAULT_ALL_POSTS_INTRO_KO = '작성된 모든 게시물을 확인할 수 있는 게시판 입니다.';
const DEFAULT_ALL_POSTS_INTRO_JA = '作成された全ての投稿を確認できる掲示板です。';

/** 조회수: 같은 방문자(IP)가 같은 글을 30분 안에 다시 열면 늘리지 않는다. */
const VIEW_DEDUPE: rate.WindowRule = { prefix: 'view', windowMs: 30 * 60 * 1000, max: 1 };

const posts = new Hono<AppEnv>();

/* ---------- 보조 ---------- */

function sanitizeCommentInput(raw: string | null): string {
  let s = raw ?? '';
  s = s.replace(/\0/g, '');
  s = s.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > 100) s = s.slice(0, 100);
  s = s.replace(/<\/textarea\b/gi, '').replace(/<\/script\b/gi, '');
  return s;
}

function editorInitB64(html: string, titleKo: string, titleJa: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ html, titleKo, titleJa }));
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function safeNewPostCancel(q: string | undefined): string {
  if (typeof q !== 'string') return '/posts';
  const t = q.trim().split('?')[0];
  if (t.startsWith('/boards/')) {
    const id = parseInt(t.slice('/boards/'.length), 10);
    return Number.isFinite(id) && id >= 1 ? `/boards/${id}` : '/posts';
  }
  const postPath = /^\/posts\/(\d+)$/.exec(t);
  if (postPath) return `/posts/${postPath[1]}`;
  return '/posts';
}

/** 다시 그린 폼이 보낸 취소 경로만 허용 */
function safeEchoCancelHref(raw: string | null): string {
  if (typeof raw !== 'string') return '/posts';
  const t = raw.trim();
  const boards = /^\/boards\/(\d+)\/?$/.exec(t);
  if (boards) return `/boards/${boards[1]}`;
  const postPath = /^\/posts\/(\d+)\/?$/.exec(t);
  if (postPath) return `/posts/${postPath[1]}`;
  return '/posts';
}

function pickDefaultProjectId(projects: Project[], raw: unknown): number | null {
  const id = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(id) || id < 1) return null;
  return projects.some((p) => p.id === id) ? id : null;
}

function resolveNewPostProjectId(projects: Project[], body: FormBody): { ok: true; id: number } | { ok: false; error: string } {
  const id = parseInt(String(field(body, 'project_id') ?? '').trim(), 10);
  const valid = Number.isFinite(id) && id >= 1 && projects.some((p) => p.id === id);
  if (field(body, '_project_form_locked') === '1') {
    return valid ? { ok: true, id } : { ok: false, error: '게시판 정보가 올바르지 않습니다.' };
  }
  return valid
    ? { ok: true, id }
    : { ok: false, error: '게시판을 선택해주세요. (-- 분류 없음 -- 은 등록할 수 없습니다.)' };
}

/** 수정 폼의 project_id: 빈 값은 분류 없음(null), 그 외엔 실제 있는 게시판만 */
async function resolveEditProjectId(db: D1Database, raw: string | null): Promise<{ ok: boolean; id: number | null }> {
  const s = (raw ?? '').trim();
  if (s === '') return { ok: true, id: null };
  const id = parseId(s);
  if (id == null) return { ok: false, id: null };
  const row = await db.prepare('SELECT id FROM projects WHERE id = ?').bind(id).first();
  return row ? { ok: true, id } : { ok: false, id: null };
}

async function loadProjects(db: D1Database, order: string): Promise<Project[]> {
  return (await db.prepare(`SELECT * FROM projects ORDER BY ${order}`).all<Project>()).results;
}

async function renderPostForm(
  c: Context<AppEnv>,
  status: 200 | 400,
  props: Omit<PostFormProps, 'nav'>
) {
  const settings = await getSiteSettings(c.env.DB);
  return c.html(<PostFormPage nav={await navData(c, settings)} {...props} />, status);
}

/* ---------- 본문 첨부 업로드 ---------- */

posts.post('/body-upload', requireAdmin, async (c) => {
  const declared = Number(c.req.header('content-length') || '0');
  if (declared > BODY_UPLOAD_MAX_BYTES + 1024 * 1024) {
    return c.json({ error: '파일이 최대 55MB를 넘을 수 없습니다.' }, 400);
  }
  let body: FormBody;
  try {
    body = await readForm(c);
  } catch {
    return c.json({ error: '업로드 실패' }, 400);
  }
  const file = fileField(body, 'file');
  if (!file) return c.json({ error: '파일이 없습니다.' }, 400);
  if (file.size > BODY_UPLOAD_MAX_BYTES) return c.json({ error: '파일이 최대 55MB를 넘을 수 없습니다.' }, 400);
  if (!/^(image\/(jpeg|png|gif|webp)|video\/(mp4|webm|quicktime))$/i.test(file.type || '')) {
    return c.json({ error: 'JPEG, PNG, GIF, WEBP 이미지 또는 MP4, WEBM 동영상만 업로드할 수 있습니다.' }, 400);
  }
  const mime = verifiedMime(await fileHead(file), [...IMAGE_MIMES, ...VIDEO_MIMES]);
  if (!mime) {
    return c.json({ error: '파일 내용이 JPEG, PNG, GIF, WEBP 이미지나 MP4, WEBM 동영상 형식이 아닙니다.' }, 400);
  }

  const key = `post-body/${crypto.randomUUID()}`;
  await c.env.MEDIA.put(key, file, { httpMetadata: { contentType: mime } });
  try {
    const row = await c.env.DB.prepare('INSERT INTO post_body_assets (r2_key, mime, size) VALUES (?, ?, ?) RETURNING id')
      .bind(key, mime, file.size)
      .first<{ id: number }>();
    if (!row) throw new Error('no id');
    return c.json({ id: row.id, url: `/media/post-body/${row.id}` });
  } catch (err) {
    await c.env.MEDIA.delete(key);
    console.error('[body-upload] 저장 실패', err);
    return c.json({ error: '저장에 실패했습니다.' }, 500);
  }
});

/* ---------- 전체 게시물 ---------- */

posts.get('/', async (c) => {
  const db = c.env.DB;
  const page = pageParam(c.req.query('page'));
  const total = Number((await db.prepare('SELECT COUNT(*) AS n FROM posts').first<{ n: number }>())?.n ?? 0);
  const totalPages = total === 0 ? 1 : Math.ceil(total / ALL_POSTS_PAGE_SIZE);
  if (page > totalPages) return c.redirect(`/posts?page=${totalPages}`);

  const { results } = await db
    .prepare(
      `SELECT p.*, pr.name AS project_name, pr.name_ja AS project_name_ja,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
         u.nickname AS author_nickname,
         g.global_num
       FROM posts p
       ${POST_GLOBAL_NUM_JOIN}
       LEFT JOIN projects pr ON p.project_id = pr.id
       LEFT JOIN users u ON p.author_id = u.id
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(ALL_POSTS_PAGE_SIZE, (page - 1) * ALL_POSTS_PAGE_SIZE)
    .all<PostRow>();

  const settings = await getSiteSettings(db);
  const introKo = settings.all_posts_intro_ko?.trim() || DEFAULT_ALL_POSTS_INTRO_KO;
  const introJa = settings.all_posts_intro_ja?.trim() || DEFAULT_ALL_POSTS_INTRO_JA;
  return c.html(
    <AllPostsPage
      nav={await navData(c, settings)}
      posts={results.map((r) => enrichListPostRow(r, LIST_BOARD_NAME_ALL_POSTS_MAX))}
      page={page}
      totalPages={totalPages}
      paginationItems={buildPaginationItems(page, totalPages)}
      introKo={introKo}
      introJa={introJa}
    />
  );
});

/* ---------- 작성 ---------- */

posts.get('/new', requireAdmin, async (c) => {
  const projects = await loadProjects(c.env.DB, 'order_num ASC, name ASC');
  const defaultProjectId = pickDefaultProjectId(projects, c.req.query('project_id'));
  return renderPostForm(c, 200, {
    post: null,
    projects,
    formAction: '/posts',
    cancelHref: safeNewPostCancel(c.req.query('cancel')),
    defaultProjectId,
    lockedProject: defaultProjectId != null ? projects.find((p) => p.id === defaultProjectId) ?? null : null,
    editorInitB64: editorInitB64('', '', ''),
    titleKo: '',
    titleJa: ''
  });
});

posts.post('/', requireAdmin, async (c) => {
  const db = c.env.DB;
  const body = await readForm(c);
  const projects = await loadProjects(db, 'order_num ASC, name ASC');
  const cancelHref = safeEchoCancelHref(field(body, '_cancel_href'));
  const locked = field(body, '_project_form_locked') === '1';
  const rawTitle = field(body, 'title') ?? '';
  const rawTitleJa = field(body, 'title_ja') ?? '';
  const contentRaw = field(body, 'content') ?? '';
  const rawProject = field(body, 'project_id');

  const again = (error: string, lockedId: number | null) =>
    renderPostForm(c, 200, {
      post: null,
      projects,
      formAction: '/posts',
      error,
      cancelHref,
      defaultProjectId: locked ? null : pickDefaultProjectId(projects, rawProject),
      lockedProject: locked ? projects.find((p) => p.id === lockedId) ?? null : null,
      editorInitB64: editorInitB64(contentRaw, rawTitle, rawTitleJa),
      titleKo: '',
      titleJa: ''
    });

  const resolved = resolveNewPostProjectId(projects, body);
  if (!resolved.ok) return again(resolved.error, parseInt(String(rawProject ?? ''), 10));

  const titleKo = rawTitle.trim();
  const titleJa = rawTitleJa.trim() || null;
  const content = await sanitizePostHtml(contentRaw);
  if (!titleKo || !isPostContentMeaningful(content)) {
    return again('국문 제목과 본문(또는 첨부 미디어)을 입력해주세요.', resolved.id);
  }

  const row = await db
    .prepare('INSERT INTO posts (title, title_ja, content, project_id, author_id) VALUES (?, ?, ?, ?, ?) RETURNING id')
    .bind(titleKo, titleJa, content, resolved.id, c.get('user')!.id)
    .first<{ id: number }>();
  return c.redirect(`/posts/${row!.id}`);
});

/* ---------- 수정 ---------- */

posts.get('/:id/edit', requireAdmin, async (c) => {
  const id = parseId(c.req.param('id'));
  const post = id ? await c.env.DB.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>() : null;
  if (!post) return renderError(c, 404, POST_NOT_FOUND);
  return renderPostForm(c, 200, {
    post: { id: post.id, project_id: post.project_id },
    projects: await loadProjects(c.env.DB, 'order_num ASC'),
    formAction: `/posts/${post.id}?_method=PUT`,
    cancelHref: `/posts/${post.id}`,
    editorInitB64: editorInitB64(post.content, post.title, post.title_ja ?? ''),
    titleKo: post.title,
    titleJa: post.title_ja ?? ''
  });
});

posts.put('/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  if (id == null) return renderError(c, 404, POST_NOT_FOUND);
  const body = await readForm(c);
  const rawTitle = field(body, 'title') ?? '';
  const rawTitleJa = field(body, 'title_ja') ?? '';
  const contentRaw = field(body, 'content') ?? '';
  const rawProject = field(body, 'project_id');

  const existing = await db.prepare('SELECT * FROM posts WHERE id = ?').bind(id).first<PostRow>();
  if (!existing) return renderError(c, 404, POST_NOT_FOUND);

  const titleKo = rawTitle.trim();
  const titleJa = rawTitleJa.trim() || null;
  const content = await sanitizePostHtml(contentRaw);
  const project = await resolveEditProjectId(db, rawProject);

  if (!titleKo || !isPostContentMeaningful(content) || !project.ok) {
    const projects = await loadProjects(db, 'order_num ASC');
    return renderPostForm(c, 400, {
      post: { id: existing.id, project_id: existing.project_id },
      projects,
      formAction: `/posts/${id}?_method=PUT`,
      error: !project.ok
        ? '게시판 정보가 올바르지 않습니다. 다시 선택해주세요.'
        : '국문 제목과 본문(또는 첨부 미디어)을 입력해주세요.',
      cancelHref: `/posts/${id}`,
      defaultProjectId: pickDefaultProjectId(projects, rawProject),
      editorInitB64: editorInitB64(contentRaw, rawTitle, rawTitleJa),
      titleKo: existing.title,
      titleJa: existing.title_ja ?? ''
    });
  }

  await db
    .prepare(`UPDATE posts SET title = ?, title_ja = ?, content = ?, project_id = ?, updated_at = ${NOW_SQL} WHERE id = ?`)
    .bind(titleKo, titleJa, content, project.id, id)
    .run();
  // 수정으로 본문에서 빠진 첨부 미디어 정리
  const kept = extractAssetIds(content);
  const dropped = [...extractAssetIds(existing.content)].filter((a) => !kept.has(a));
  await deleteAssetsIfUnreferenced(c.env, dropped);
  return c.redirect(`/posts/${id}`);
});

/* ---------- 삭제 ---------- */

posts.delete('/:id', requireLogin, async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  const post = id ? await db.prepare('SELECT author_id, content FROM posts WHERE id = ?').bind(id).first<PostRow>() : null;
  if (!post || id == null) return renderError(c, 404, POST_NOT_FOUND);
  const user = c.get('user')!;
  if (post.author_id !== user.id && !user.isAdmin) {
    return renderError(c, 403, '이 게시물을 삭제할 권한이 없습니다.');
  }
  // 댓글·알림은 외래 키(ON DELETE CASCADE)로 함께 지워진다.
  await db.prepare('DELETE FROM posts WHERE id = ?').bind(id).run();
  await deleteAssetsIfUnreferenced(c.env, extractAssetIds(post.content));
  const body = await readForm(c).catch(() => ({}) as FormBody);
  return c.redirect(sanitizeMypageWritingsNext(field(body, 'next')) || '/posts');
});

/* ---------- 상세 ---------- */

posts.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  if (id == null) return renderError(c, 404, POST_NOT_FOUND);
  const post = await db
    .prepare(
      `SELECT p.*, pr.name AS project_name, pr.name_ja AS project_name_ja,
         pr.description AS project_description, u.nickname AS author_nickname
       FROM posts p
       LEFT JOIN projects pr ON p.project_id = pr.id
       LEFT JOIN users u ON p.author_id = u.id
       WHERE p.id = ?`
    )
    .bind(id)
    .first<PostRow & { project_description: string | null }>();
  if (!post) return renderError(c, 404, POST_NOT_FOUND);

  let viewCount = Number(post.view_count ?? 0);
  const viewKey = `${clientIp(c)}|${id}`;
  if (!(await rate.isLimited(db, VIEW_DEDUPE, viewKey))) {
    await rate.hit(db, VIEW_DEDUPE, viewKey);
    await db.prepare('UPDATE posts SET view_count = view_count + 1 WHERE id = ?').bind(id).run();
    viewCount += 1;
  }

  const { results } = await db
    .prepare(
      `SELECT c.*, u.nickname
         FROM comments c LEFT JOIN users u ON c.user_id = u.id
        WHERE c.post_id = ?
        ORDER BY c.created_at ASC, c.id ASC`
    )
    .bind(id)
    .all<{ id: number; user_id: number; content: string; created_at: string; updated_at: string; nickname: string | null }>();

  const comments: CommentView[] = results.map((cm) => {
    const edited = isEditedAfterCreate(cm.created_at, cm.updated_at);
    const shown = cm.updated_at || cm.created_at;
    const suffix = edited ? ' (수정)' : '';
    return {
      id: cm.id,
      user_id: cm.user_id,
      nickname: cm.nickname,
      avatarUrl: `/media/user/${cm.user_id}/avatar`,
      content: cm.content,
      display_time_iso: toIsoUtc(shown),
      display_time_suffix: suffix,
      display_time_line: formatCommentDateTime(shown) + suffix
    };
  });

  const asHtml = postContentLooksLikeHtml(post.content);
  const detail: PostDetail = {
    id: post.id,
    title: post.title,
    title_ja: post.title_ja,
    project_id: post.project_id,
    project_name: post.project_name ?? null,
    project_name_ja: post.project_name_ja ?? null,
    project_description: post.project_description,
    author_nickname: post.author_nickname ?? null,
    view_count: viewCount
  };
  const settings = await getSiteSettings(db);
  return c.html(
    <PostPage
      nav={await navData(c, settings)}
      post={detail}
      contentHtml={asHtml ? await sanitizePostHtml(post.content) : plainTextToHtml(post.content)}
      contentAsHtml={asHtml}
      createdIso={toIsoUtc(post.created_at)}
      createdDisplay={formatListTime(post.created_at)}
      updatedIso={toIsoUtc(post.updated_at)}
      updatedDisplay={formatListTime(post.updated_at)}
      edited={isEditedAfterCreate(post.created_at, post.updated_at)}
      comments={comments}
    />
  );
});

/* ---------- 댓글 ---------- */

posts.post('/:id/comments', requireLogin, async (c) => {
  const db = c.env.DB;
  const postId = parseId(c.req.param('id'));
  if (postId == null) return renderError(c, 404, POST_NOT_FOUND);
  const content = sanitizeCommentInput(field(await readForm(c), 'content'));
  if (!content) return c.redirect(`/posts/${postId}#comments`);
  if (!(await db.prepare('SELECT id FROM posts WHERE id = ?').bind(postId).first())) {
    return renderError(c, 404, POST_NOT_FOUND);
  }
  const userId = c.get('user')!.id;
  const row = await db
    .prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?) RETURNING id')
    .bind(postId, userId, content)
    .first<{ id: number }>();
  if (row) {
    try {
      await createCommentNotification(db, postId, row.id, userId);
    } catch (err) {
      console.error('[comments] 알림 생성 실패', err); // 댓글은 유지
    }
  }
  return c.redirect(`/posts/${postId}#comments`);
});

posts.put('/:postId/comments/:commentId', requireLogin, async (c) => {
  const db = c.env.DB;
  const postId = parseId(c.req.param('postId'));
  const commentId = parseId(c.req.param('commentId'));
  if (postId == null) return renderError(c, 404, POST_NOT_FOUND);
  if (commentId == null) return renderError(c, 404, '댓글을 찾을 수 없습니다.');
  const content = sanitizeCommentInput(field(await readForm(c), 'content'));
  if (!content) return c.redirect(`/posts/${postId}#comments`);
  const row = await db
    .prepare('SELECT user_id FROM comments WHERE id = ? AND post_id = ?')
    .bind(commentId, postId)
    .first<{ user_id: number }>();
  if (!row) return renderError(c, 404, '댓글을 찾을 수 없습니다.');
  if (row.user_id !== c.get('user')!.id) return renderError(c, 403, '본인 댓글만 수정할 수 있습니다.');
  await db
    .prepare(`UPDATE comments SET content = ?, updated_at = ${NOW_SQL} WHERE id = ? AND post_id = ?`)
    .bind(content, commentId, postId)
    .run();
  return c.redirect(`/posts/${postId}#comments`);
});

posts.delete('/:postId/comments/:commentId', requireLogin, async (c) => {
  const db = c.env.DB;
  const postId = parseId(c.req.param('postId'));
  const commentId = parseId(c.req.param('commentId'));
  if (postId == null) return renderError(c, 404, POST_NOT_FOUND);
  if (commentId == null) return c.redirect(`/posts/${postId}#comments`);
  const row = await db
    .prepare('SELECT user_id FROM comments WHERE id = ? AND post_id = ?')
    .bind(commentId, postId)
    .first<{ user_id: number }>();
  if (!row) return c.redirect(`/posts/${postId}#comments`);
  const user = c.get('user')!;
  if (row.user_id !== user.id && !user.isAdmin) return renderError(c, 403, '이 댓글을 삭제할 권한이 없습니다.');
  await db.prepare('DELETE FROM comments WHERE id = ? AND post_id = ?').bind(commentId, postId).run();
  const body = await readForm(c).catch(() => ({}) as FormBody);
  return c.redirect(sanitizeMypageWritingsNext(field(body, 'next')) || `/posts/${postId}#comments`);
});

export default posts;
