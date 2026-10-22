/** 게시물·댓글·본문 첨부 업로드 (기존 routes/posts.js 이식) */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { PostFormPage, PostPage, type CommentView, type PostDetail, type PostFormProps } from '../views/post';
import { AllPostsPage } from '../views/lists';
import {
  buildNavData,
  readField,
  readForm,
  renderError,
  requireAdmin,
  requireLogin,
  type FormBody
} from '../lib/http';
import { parseId } from '../lib/ids';
import {
  buildSettingsStatements,
  enrichListPostRow,
  parseSettingsResults,
  POST_GLOBAL_NUM_JOIN,
  LIST_POST_COLUMNS,
  type ListPostRow,
  type PostRow,
  type Project,
  type Settings
} from '../lib/siteData';
import {
  buildPaginationItems,
  countPages,
  formatCommentDateTime,
  formatListTime,
  isEditedAfterCreate,
  LIST_BOARD_NAME_ALL_POSTS_MAX,
  NOW_SQL,
  parsePageParam,
  toIsoUtc
} from '../lib/time';
import { convertPlainTextToHtml, isHtmlContent, isPostContentMeaningful, sanitizePostHtml } from '../lib/html';
import { buildMarkAttachedStatements, deleteAssetsIfUnreferenced, extractAssetIds } from '../lib/postAssets';
import { isOverD1ValueLimit } from '../lib/dbLimits';
import {
  buildNotificationForNewComment,
  buildPostAuthorStatement,
  shouldNotifyAuthor,
  type PostAuthorRow
} from '../lib/commentNotifications';
import { sanitizeMypageWritingsNext } from '../lib/mypageWritings';
import { MEDIA_MIMES } from '../lib/fileSniff';
import { streamUploadToR2 } from '../lib/upload';
import { getClientIp } from '../lib/security';
import * as rate from '../lib/rateLimit';

/** 전체 게시물 목록 한 페이지 크기 (기존 서버와 같음) */
const ALL_POSTS_PAGE_SIZE = 200;
/** 본문 첨부 최대 크기: 55MB (기존 서버와 같음, 짧은 동영상 기준). R2로 바로 흘려보내 메모리에 모으지 않는다. */
const BODY_UPLOAD_MAX_BYTES = 55 * 1024 * 1024;
/** 본문이 D1 값 하나의 저장 상한(약 2MB)을 넘을 때 안내 (큰 이미지·동영상은 첨부 업로드로 넣어야 함) */
const CONTENT_TOO_LARGE_MESSAGE = '본문이 너무 큽니다 (최대 약 2MB). 이미지·동영상은 붙여 넣지 말고 첨부 버튼으로 올려주세요.';
/** 댓글 최대 길이 (글자) */
const COMMENT_MAX_LENGTH = 100;
const POST_NOT_FOUND = '게시물을 찾을 수 없습니다.';
const DEFAULT_ALL_POSTS_INTRO_KO = '작성된 모든 게시물을 확인할 수 있는 게시판 입니다.';
const DEFAULT_ALL_POSTS_INTRO_JA = '作成された全ての投稿を確認できる掲示板です。';

/** 조회수: 같은 방문자(IP)가 같은 글을 30분 안에 다시 열면 늘리지 않는다. */
const VIEW_DEDUPE: rate.WindowRule = { prefix: 'view', windowMs: 30 * 60 * 1000, max: 1 };

/** 게시판 목록 정렬 (SQL에 그대로 넣으므로 코드 안의 고정 값만 허용) */
type ProjectOrder = 'order_num ASC, name ASC' | 'order_num ASC';

const posts = new Hono<AppEnv>();

/* ---------- 보조 ---------- */

/** 댓글 입력 정리: 한 줄로 합치고 100자로 자르며, textarea·script 경계 문자열을 지운다 (기존과 같음) */
function sanitizeCommentInput(raw: string | null): string {
  let text = (raw ?? '').replace(/\0/g, '');
  text = text.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > COMMENT_MAX_LENGTH) text = text.slice(0, COMMENT_MAX_LENGTH);
  return text.replace(/<\/textarea\b/gi, '').replace(/<\/script\b/gi, '');
}

/**
 * base64 변환 때 String.fromCharCode에 한 번에 넘기는 바이트 수: 32KB.
 * 한 바이트씩 이어 붙이면 큰 본문에서 문자열 조각이 바이트 수만큼 생겨 메모리·CPU가 크게 늘고,
 * 한 번에 전부 넘기면 함수 인자 수 상한을 넘는다.
 */
const BASE64_CHUNK_BYTES = 0x8000;

/** 에디터 초기값(본문·제목)을 post-editor.js가 읽는 base64 JSON으로 만든다 */
function encodeEditorInit(html: string, titleKo: string, titleJa: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify({ html, titleKo, titleJa }));
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}

/** 새 글 화면의 취소 경로: 게시판·게시물·전체 목록 중 하나만 허용 */
function resolveNewPostCancel(query: string | undefined): string {
  if (typeof query !== 'string') return '/posts';
  const path = query.trim().split('?')[0];
  if (path.startsWith('/boards/')) {
    const id = parseId(path.slice('/boards/'.length));
    return id != null ? `/boards/${id}` : '/posts';
  }
  const postId = parseId(/^\/posts\/(\d+)$/.exec(path)?.[1]);
  return postId != null ? `/posts/${postId}` : '/posts';
}

/** 다시 그린 폼이 보낸 취소 경로만 허용 */
function resolveEchoCancelHref(raw: string | null): string {
  if (typeof raw !== 'string') return '/posts';
  const path = raw.trim();
  const boardId = parseId(/^\/boards\/(\d+)\/?$/.exec(path)?.[1]);
  if (boardId != null) return `/boards/${boardId}`;
  const postId = parseId(/^\/posts\/(\d+)\/?$/.exec(path)?.[1]);
  return postId != null ? `/posts/${postId}` : '/posts';
}

function pickDefaultProjectId(projects: Project[], raw: unknown): number | null {
  const id = parseId(raw);
  if (id == null) return null;
  return projects.some((p) => p.id === id) ? id : null;
}

function resolveNewPostProjectId(projects: Project[], body: FormBody): { ok: true; id: number } | { ok: false; error: string } {
  const id = parseId(readField(body, 'project_id'));
  if (id != null && projects.some((p) => p.id === id)) return { ok: true, id };
  // 게시판에서 들어온 글(게시판 고정)과 직접 고른 글의 안내 문구가 다르다 (기존과 같음).
  return readField(body, '_project_form_locked') === '1'
    ? { ok: false, error: '게시판 정보가 올바르지 않습니다.' }
    : { ok: false, error: '게시판을 선택해주세요. (-- 분류 없음 -- 은 등록할 수 없습니다.)' };
}

/**
 * 수정 폼의 project_id 형식 확인: 빈 값은 분류 없음(null), 숫자가 아니면 오류.
 * 실제로 있는 게시판인지는 호출하는 쪽이 다른 쿼리와 함께 확인한다.
 */
function parseEditProjectId(raw: string | null): { isValid: boolean; id: number | null } {
  const text = (raw ?? '').trim();
  if (text === '') return { isValid: true, id: null };
  const id = parseId(text);
  return id == null ? { isValid: false, id: null } : { isValid: true, id };
}

/** 게시판 목록 쿼리. 화면에 필요한 다른 쿼리와 한 번의 db.batch로 보낸다. */
function buildProjectsStatement(db: D1Database, order: ProjectOrder): D1PreparedStatement {
  return db.prepare(`SELECT * FROM projects ORDER BY ${order}`);
}

/** 글 작성·수정 폼. 사이트 설정은 호출하는 쪽이 다른 쿼리와 함께 읽어서 넘긴다 (D1 왕복 절약). */
async function renderPostForm(
  c: Context<AppEnv>,
  status: 200 | 400,
  props: Omit<PostFormProps, 'nav'>,
  settings: Settings
) {
  return c.html(<PostFormPage nav={await buildNavData(c, settings)} {...props} />, status);
}

/* ---------- 본문 첨부 업로드 (post-editor.js가 파일 본문을 그대로 보냄) ---------- */

posts.post('/body-upload', requireAdmin, async (c) => {
  const length = Number(c.req.header('content-length'));
  const body = c.req.raw.body;
  if (!body || !Number.isSafeInteger(length) || length <= 0) return c.json({ error: '파일이 없습니다.' }, 400);
  if (length > BODY_UPLOAD_MAX_BYTES) return c.json({ error: '파일이 최대 55MB를 넘을 수 없습니다.' }, 400);
  const declaredType = (c.req.header('content-type') || '').split(';')[0].trim();
  if (!MEDIA_MIMES.includes(declaredType.toLowerCase())) {
    return c.json({ error: 'JPEG, PNG, GIF, WEBP 이미지 또는 MP4, WEBM, MOV 동영상만 업로드할 수 있습니다.' }, 400);
  }

  const key = `post-body/${crypto.randomUUID()}`;
  const stored = await streamUploadToR2(c.env.MEDIA, key, body, length, MEDIA_MIMES);
  if (!stored.ok) {
    return c.json(
      {
        error:
          stored.reason === 'type'
            ? '파일 내용이 JPEG, PNG, GIF, WEBP 이미지나 MP4, WEBM, MOV 동영상 형식이 아닙니다.'
            : '업로드 실패'
      },
      400
    );
  }
  try {
    const row = await c.env.DB.prepare('INSERT INTO post_body_assets (r2_key, mime, size) VALUES (?, ?, ?) RETURNING id')
      .bind(key, stored.mime, length)
      .first<{ id: number }>();
    if (!row) throw new Error('INSERT returned no row');
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
  const page = parsePageParam(c.req.query('page'));
  // 개수·목록·설정을 한 번에 가져온다 (목록은 이 페이지 행을 먼저 고른 뒤 댓글 수를 센다). 범위를 벗어나면 아래에서 마지막 페이지로 보낸다.
  const [countRes, listRes, settingRows, settingImageRes] = await db.batch([
    db.prepare('SELECT COUNT(*) AS count FROM posts'),
    db
      .prepare(
        `SELECT ${LIST_POST_COLUMNS}, pr.name AS project_name, pr.name_ja AS project_name_ja,
           (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
           u.nickname AS author_nickname,
           g.global_num
         FROM (SELECT ${LIST_POST_COLUMNS} FROM posts p ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?) p
         ${POST_GLOBAL_NUM_JOIN}
         LEFT JOIN projects pr ON p.project_id = pr.id
         LEFT JOIN users u ON p.author_id = u.id
         ORDER BY p.created_at DESC, p.id DESC`
      )
      .bind(ALL_POSTS_PAGE_SIZE, (page - 1) * ALL_POSTS_PAGE_SIZE),
    ...buildSettingsStatements(db)
  ]);
  const total = Number((countRes.results[0] as { count: number } | undefined)?.count ?? 0);
  const totalPages = countPages(total, ALL_POSTS_PAGE_SIZE);
  if (page > totalPages) return c.redirect(`/posts?page=${totalPages}`);

  const settings = parseSettingsResults(settingRows, settingImageRes);
  return c.html(
    <AllPostsPage
      nav={await buildNavData(c, settings)}
      posts={(listRes.results as ListPostRow[]).map((row) => enrichListPostRow(row, LIST_BOARD_NAME_ALL_POSTS_MAX))}
      page={page}
      totalPages={totalPages}
      paginationItems={buildPaginationItems(page, totalPages)}
      introKo={settings.all_posts_intro_ko?.trim() || DEFAULT_ALL_POSTS_INTRO_KO}
      introJa={settings.all_posts_intro_ja?.trim() || DEFAULT_ALL_POSTS_INTRO_JA}
    />
  );
});

/* ---------- 작성 ---------- */

posts.get('/new', requireAdmin, async (c) => {
  const db = c.env.DB;
  // 게시판 목록과 사이트 설정을 한 번에 가져온다.
  const [projectRes, settingRows, settingImageRes] = await db.batch([
    buildProjectsStatement(db, 'order_num ASC, name ASC'),
    ...buildSettingsStatements(db)
  ]);
  const projects = projectRes.results as Project[];
  const defaultProjectId = pickDefaultProjectId(projects, c.req.query('project_id'));
  return renderPostForm(c, 200, {
    post: null,
    projects,
    formAction: '/posts',
    cancelHref: resolveNewPostCancel(c.req.query('cancel')),
    defaultProjectId,
    lockedProject: defaultProjectId != null ? projects.find((p) => p.id === defaultProjectId) ?? null : null,
    editorInitBase64: encodeEditorInit('', '', ''),
    titleKo: '',
    titleJa: ''
  }, parseSettingsResults(settingRows, settingImageRes));
});

posts.post('/', requireAdmin, async (c) => {
  const db = c.env.DB;
  const body = await readForm(c);
  // 게시판 목록(검증용)과 사이트 설정(오류 폼을 다시 그릴 때)을 한 번에 가져온다.
  const [projectRes, settingRows, settingImageRes] = await db.batch([
    buildProjectsStatement(db, 'order_num ASC, name ASC'),
    ...buildSettingsStatements(db)
  ]);
  const projects = projectRes.results as Project[];
  const cancelHref = resolveEchoCancelHref(readField(body, '_cancel_href'));
  const isProjectLocked = readField(body, '_project_form_locked') === '1';
  const rawTitle = readField(body, 'title') ?? '';
  const rawTitleJa = readField(body, 'title_ja') ?? '';
  // 에디터 초기값도 innerHTML로 들어가므로, 오류 화면에 돌려줄 때도 정제한 본문을 쓴다.
  const content = await sanitizePostHtml(readField(body, 'content') ?? '');
  const rawProjectId = readField(body, 'project_id');

  // 기존 서버와 같이 오류 폼은 200으로 다시 그리고, 입력값은 에디터 초기값으로 돌려준다.
  const renderAgain = (error: string, lockedId: number | null, editorHtml = content) =>
    renderPostForm(c, 200, {
      post: null,
      projects,
      formAction: '/posts',
      error,
      cancelHref,
      defaultProjectId: isProjectLocked ? null : pickDefaultProjectId(projects, rawProjectId),
      lockedProject: isProjectLocked ? projects.find((p) => p.id === lockedId) ?? null : null,
      editorInitBase64: encodeEditorInit(editorHtml, rawTitle, rawTitleJa),
      titleKo: '',
      titleJa: ''
    }, parseSettingsResults(settingRows, settingImageRes));

  const resolved = resolveNewPostProjectId(projects, body);
  if (!resolved.ok) return renderAgain(resolved.error, parseId(rawProjectId));

  const titleKo = rawTitle.trim();
  const titleJa = rawTitleJa.trim() || null;
  if (!titleKo || !isPostContentMeaningful(content)) {
    return renderAgain('국문 제목과 본문(또는 첨부 미디어)을 입력해주세요.', resolved.id);
  }
  // 저장할 수 없을 만큼 큰 본문은 에디터로 되돌려 보내지 않는다 (응답을 만들며 메모리를 더 쓰지 않게).
  if (isOverD1ValueLimit(content)) return renderAgain(CONTENT_TOO_LARGE_MESSAGE, resolved.id, '');

  // 글 저장과 본문 첨부의 "붙음" 표시를 한 번에 보낸다.
  const [insertRes] = await db.batch([
    db
      .prepare('INSERT INTO posts (title, title_ja, content, project_id, author_id) VALUES (?, ?, ?, ?, ?) RETURNING id')
      .bind(titleKo, titleJa, content, resolved.id, c.get('user')!.id),
    ...buildMarkAttachedStatements(db, content)
  ]);
  const row = insertRes.results[0] as { id: number };
  return c.redirect(`/posts/${row.id}`);
});

/* ---------- 수정 ---------- */

posts.get('/:id/edit', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  if (id == null) return renderError(c, 404, POST_NOT_FOUND);
  // 게시물·게시판 목록·사이트 설정을 한 번에 가져온다.
  const [postRes, projectRes, settingRows, settingImageRes] = await db.batch([
    db.prepare('SELECT * FROM posts WHERE id = ?').bind(id),
    buildProjectsStatement(db, 'order_num ASC'),
    ...buildSettingsStatements(db)
  ]);
  const post = postRes.results[0] as PostRow | undefined;
  if (!post) return renderError(c, 404, POST_NOT_FOUND);
  return renderPostForm(c, 200, {
    post: { id: post.id, project_id: post.project_id },
    projects: projectRes.results as Project[],
    formAction: `/posts/${post.id}?_method=PUT`,
    cancelHref: `/posts/${post.id}`,
    editorInitBase64: encodeEditorInit(post.content, post.title, post.title_ja ?? ''),
    titleKo: post.title,
    titleJa: post.title_ja ?? ''
  }, parseSettingsResults(settingRows, settingImageRes));
});

posts.put('/:id', requireAdmin, async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  if (id == null) return renderError(c, 404, POST_NOT_FOUND);
  const body = await readForm(c);
  const rawTitle = readField(body, 'title') ?? '';
  const rawTitleJa = readField(body, 'title_ja') ?? '';
  const rawProjectId = readField(body, 'project_id');

  // 기존 게시물과 선택한 게시판을 한 번에 조회한다 (게시판을 고르지 않았으면 0번 id라 항상 비어 있음).
  const projectInput = parseEditProjectId(rawProjectId);
  const [existingRes, projectRes] = await db.batch([
    db.prepare('SELECT * FROM posts WHERE id = ?').bind(id),
    db.prepare('SELECT id FROM projects WHERE id = ?').bind(projectInput.id ?? 0)
  ]);
  const existing = existingRes.results[0] as PostRow | undefined;
  if (!existing) return renderError(c, 404, POST_NOT_FOUND);
  const project = {
    ok: projectInput.isValid && (projectInput.id == null || projectRes.results.length > 0),
    id: projectInput.id
  };

  const titleKo = rawTitle.trim();
  const titleJa = rawTitleJa.trim() || null;
  const content = await sanitizePostHtml(readField(body, 'content') ?? '');

  const isContentTooLarge = isOverD1ValueLimit(content);
  if (!titleKo || !isPostContentMeaningful(content) || !project.ok || isContentTooLarge) {
    // 오류 폼에 필요한 게시판 목록과 사이트 설정을 한 번에 가져온다.
    const [projectRes, settingRows, settingImageRes] = await db.batch([
      buildProjectsStatement(db, 'order_num ASC'),
      ...buildSettingsStatements(db)
    ]);
    const projects = projectRes.results as Project[];
    return renderPostForm(c, 400, {
      post: { id: existing.id, project_id: existing.project_id },
      projects,
      formAction: `/posts/${id}?_method=PUT`,
      error: !project.ok
        ? '게시판 정보가 올바르지 않습니다. 다시 선택해주세요.'
        : isContentTooLarge
          ? CONTENT_TOO_LARGE_MESSAGE
          : '국문 제목과 본문(또는 첨부 미디어)을 입력해주세요.',
      cancelHref: `/posts/${id}`,
      defaultProjectId: pickDefaultProjectId(projects, rawProjectId),
      // 정제한 본문을 돌려주되, 저장할 수 없을 만큼 크면 대신 저장된 본문을 보여 준다.
      editorInitBase64: encodeEditorInit(isContentTooLarge ? existing.content : content, rawTitle, rawTitleJa),
      titleKo: existing.title,
      titleJa: existing.title_ja ?? ''
    }, parseSettingsResults(settingRows, settingImageRes));
  }

  // 수정 저장과, 수정으로 본문에서 빠진 첨부의 참조 확인을 한 번에 보낸다.
  const keptIds = extractAssetIds(content);
  const droppedIds = [...extractAssetIds(existing.content)].filter((assetId) => !keptIds.has(assetId));
  await deleteAssetsIfUnreferenced(c.env, droppedIds, [
    db
      .prepare(`UPDATE posts SET title = ?, title_ja = ?, content = ?, project_id = ?, updated_at = ${NOW_SQL} WHERE id = ?`)
      .bind(titleKo, titleJa, content, project.id, id),
    ...buildMarkAttachedStatements(db, content)
  ]);
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
  // 게시물 삭제와 첨부 참조 확인을 한 번에 보낸다 (댓글·알림은 외래 키 ON DELETE CASCADE로 함께 지워짐).
  await deleteAssetsIfUnreferenced(c.env, extractAssetIds(post.content), [
    db.prepare('DELETE FROM posts WHERE id = ?').bind(id)
  ]);
  const body = await readForm(c).catch(() => ({}) as FormBody);
  return c.redirect(sanitizeMypageWritingsNext(readField(body, 'next')) || '/posts');
});

/* ---------- 상세 ---------- */

type CommentRow = { id: number; user_id: number; content: string; created_at: string; updated_at: string; nickname: string | null };

/**
 * 게시물 상세. 게시물·댓글·사이트 설정 조회와 조회수 처리를 D1 왕복 한 번으로 보낸다.
 * 조회수: 같은 방문자의 30분 내 재방문은 세지 않는다. batch는 순서대로 한 트랜잭션에서 실행되므로,
 * 방문 기록(buildHit) 뒤의 UPDATE는 이번이 이 시간 창의 첫 방문(count = 1)일 때만 1을 더한다.
 * 본문은 저장할 때 이미 정제했지만 출력 때 한 번 더 정제한다. 캐시 키에 수정 시각을 넣어 글이 바뀌기 전까지는 다시 계산하지 않는다.
 */
posts.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = parseId(c.req.param('id'));
  if (id == null) return renderError(c, 404, POST_NOT_FOUND);

  const viewKey = `${getClientIp(c)}|${id}`;
  const [postRes, commentRes, settingRows, settingImageRes, , viewUpdateRes] = await db.batch([
    db
      .prepare(
        `SELECT p.*, pr.name AS project_name, pr.name_ja AS project_name_ja,
           pr.description AS project_description, u.nickname AS author_nickname
         FROM posts p
         LEFT JOIN projects pr ON p.project_id = pr.id
         LEFT JOIN users u ON p.author_id = u.id
         WHERE p.id = ?`
      )
      .bind(id),
    db
      .prepare(
        `SELECT c.id, c.user_id, c.content, c.created_at, c.updated_at, u.nickname
           FROM comments c LEFT JOIN users u ON c.user_id = u.id
          WHERE c.post_id = ?
          ORDER BY c.created_at ASC, c.id ASC`
      )
      .bind(id),
    ...buildSettingsStatements(db),
    rate.buildHit(db, VIEW_DEDUPE, viewKey),
    db
      .prepare(
        `UPDATE posts SET view_count = view_count + 1
          WHERE id = ?1 AND (SELECT count FROM rate_limits WHERE key = ?2) = 1
          RETURNING view_count`
      )
      .bind(id, rate.buildRateLimitKey(VIEW_DEDUPE, viewKey))
  ]);
  const post = postRes.results[0] as (PostRow & { project_description: string | null }) | undefined;
  if (!post) return renderError(c, 404, POST_NOT_FOUND);
  const settings = parseSettingsResults(settingRows, settingImageRes);
  // 조회수를 늘렸으면 늘린 값, 아니면 게시물 조회 때 읽은 값
  const viewUpdate = viewUpdateRes.results[0] as { view_count: number } | undefined;
  const viewCount = Number(viewUpdate?.view_count ?? post.view_count ?? 0);

  const comments: CommentView[] = (commentRes.results as CommentRow[]).map((comment) => {
    const isEdited = isEditedAfterCreate(comment.created_at, comment.updated_at);
    const shownAt = comment.updated_at || comment.created_at;
    const suffix = isEdited ? ' (수정)' : '';
    return {
      id: comment.id,
      user_id: comment.user_id,
      nickname: comment.nickname,
      avatarUrl: `/media/user/${comment.user_id}/avatar`,
      content: comment.content,
      display_time_iso: toIsoUtc(shownAt),
      display_time_suffix: suffix,
      display_time_line: formatCommentDateTime(shownAt) + suffix
    };
  });

  const isHtml = isHtmlContent(post.content);
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
  const contentHtml = isHtml
    ? await sanitizePostHtml(post.content, `post:${post.id}:${post.updated_at}`)
    : convertPlainTextToHtml(post.content);
  return c.html(
    <PostPage
      nav={await buildNavData(c, settings)}
      post={detail}
      contentHtml={contentHtml}
      isContentHtml={isHtml}
      createdIso={toIsoUtc(post.created_at)}
      createdDisplay={formatListTime(post.created_at)}
      updatedIso={toIsoUtc(post.updated_at)}
      updatedDisplay={formatListTime(post.updated_at)}
      isEdited={isEditedAfterCreate(post.created_at, post.updated_at)}
      comments={comments}
    />
  );
});

/* ---------- 댓글 ---------- */

posts.post('/:id/comments', requireLogin, async (c) => {
  const db = c.env.DB;
  const postId = parseId(c.req.param('id'));
  if (postId == null) return renderError(c, 404, POST_NOT_FOUND);
  const content = sanitizeCommentInput(readField(await readForm(c), 'content'));
  if (!content) return c.redirect(`/posts/${postId}#comments`);
  // 게시물 존재와 작성자(알림 대상) 확인을 한 번에 읽는다.
  const post = await buildPostAuthorStatement(db, postId).first<PostAuthorRow>();
  if (!post) return renderError(c, 404, POST_NOT_FOUND);
  const userId = c.get('user')!.id;
  // 댓글과 알림을 한 번에 넣는다.
  const statements = [db.prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)').bind(postId, userId, content)];
  if (shouldNotifyAuthor(post, userId)) {
    statements.push(buildNotificationForNewComment(db, post.author_id, postId, userId));
  }
  await db.batch(statements);
  return c.redirect(`/posts/${postId}#comments`);
});

posts.put('/:postId/comments/:commentId', requireLogin, async (c) => {
  const db = c.env.DB;
  const postId = parseId(c.req.param('postId'));
  const commentId = parseId(c.req.param('commentId'));
  if (postId == null) return renderError(c, 404, POST_NOT_FOUND);
  if (commentId == null) return renderError(c, 404, '댓글을 찾을 수 없습니다.');
  const content = sanitizeCommentInput(readField(await readForm(c), 'content'));
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
  return c.redirect(sanitizeMypageWritingsNext(readField(body, 'next')) || `/posts/${postId}#comments`);
});

export default posts;
