const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../lib/db');
const { requireAdmin, requireLogin, isUserAdmin } = require('../middleware/auth');
const { getSiteSettings, POST_GLOBAL_NUM_JOIN, enrichListPostRow } = require('../lib/siteData');
const {
  toIsoUtc,
  formatListTime,
  formatCommentDateTime,
  isEditedAfterCreate,
  buildPaginationItems,
  truncateBoardNameLine,
  LIST_BOARD_NAME_ALL_POSTS_MAX
} = require('../lib/listingHelpers');
const { asyncRoute } = require('../lib/asyncRoute');
const { sanitizeMypageWritingsNext } = require('../lib/mypageWritings');
const { createCommentNotification } = require('../lib/commentNotifications');
const { sanitizePostHtml, isPostContentMeaningful, postContentLooksLikeHtml } = require('../lib/postHtml');
const { parseId, idParam } = require('../lib/ids');
const { extractAssetIds, deleteAssetsIfUnreferenced } = require('../lib/postAssets');
const { verifiedMime, IMAGE_MIMES, VIDEO_MIMES } = require('../lib/fileSniff');

const ALL_POSTS_PAGE_SIZE = 200;

router.param('id', idParam('게시물을 찾을 수 없습니다.'));
router.param('postId', idParam('게시물을 찾을 수 없습니다.'));
router.param('commentId', idParam('댓글을 찾을 수 없습니다.'));

/*
 * 조회수: 같은 방문자(IP)가 같은 글을 30분 안에 다시 열면 증가하지 않음.
 * 단일 인스턴스 메모리 기준이며, 항목 수가 많아지면 오래된 것부터 비운다.
 */
const VIEW_DEDUPE_MS = 30 * 60 * 1000;
const VIEW_DEDUPE_MAX_KEYS = 50000;
const recentViews = new Map();

function shouldCountView(req, postId) {
  const key = `${req.ip}|${postId}`;
  const now = Date.now();
  const last = recentViews.get(key);
  if (last != null && now - last < VIEW_DEDUPE_MS) return false;
  /* 갱신 시 delete 후 set 하므로 Map 순서 = 오래된 순 */
  recentViews.delete(key);
  if (recentViews.size >= VIEW_DEDUPE_MAX_KEYS) {
    for (const k of recentViews.keys()) {
      recentViews.delete(k);
      if (recentViews.size < VIEW_DEDUPE_MAX_KEYS * 0.9) break;
    }
  }
  recentViews.set(key, now);
  return true;
}

/** 수정 폼의 project_id: 빈 값은 분류 없음(null), 그 외엔 실제 존재하는 게시판만 */
async function resolveEditProjectId(raw) {
  const s = raw != null ? String(raw).trim() : '';
  if (s === '') return { ok: true, project_id: null };
  const id = parseId(s);
  if (id == null) return { ok: false };
  const row = await db.get('SELECT id FROM projects WHERE id = ?', [id]);
  return row ? { ok: true, project_id: id } : { ok: false };
}

/** express.urlencoded가 같은 키를 배열로 줄 때, 비어 있지 않은 값 중 마지막을 택함 */
function bodyScalarPreferLast(v) {
  if (v == null) return null;
  const xs = Array.isArray(v) ? v : [v];
  let last = null;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (x == null) continue;
    const s = String(x).trim();
    if (s === '') continue;
    last = s;
  }
  return last;
}

function sanitizeCommentInput(raw) {
  let s = raw != null ? String(raw) : '';
  /* PostgreSQL TEXT에 NUL 문자는 허용되지 않음 */
  s = s.replace(/\0/g, '');
  s = s.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > 100) s = s.slice(0, 100);
  /* textarea·스크립트 경계 문자열로 인한 마크업 깨짐·서버 템플릿 오류 방지 */
  s = s.replace(/<\/textarea\b/gi, '');
  s = s.replace(/<\/script\b/gi, '');
  return s;
}

function editorInitB64From(obj) {
  return Buffer.from(
    JSON.stringify({
      html: obj.html != null ? String(obj.html) : '',
      titleKo: obj.titleKo != null ? String(obj.titleKo) : '',
      titleJa: obj.titleJa != null ? String(obj.titleJa) : ''
    }),
    'utf8'
  ).toString('base64');
}

function safeNewPostCancel(queryCancel) {
  if (queryCancel == null || typeof queryCancel !== 'string') return '/posts';
  const t = queryCancel.trim().split('?')[0];
  if (t.startsWith('/boards/')) {
    const rest = t.slice('/boards/'.length);
    const id = parseInt(rest, 10);
    if (!Number.isFinite(id) || id < 1) return '/posts';
    return `/boards/${id}`;
  }
  const postPath = /^\/posts\/(\d+)$/.exec(t);
  if (postPath) return `/posts/${postPath[1]}`;
  if (t === '/posts') return '/posts';
  return '/posts';
}

/** POST 재표시 시 폼에 실었던 취소 경로만 허용 */
function safeEchoCancelHref(raw) {
  if (raw == null || typeof raw !== 'string') return '/posts';
  const t = raw.trim();
  if (t === '/posts') return '/posts';
  const boards = /^\/boards\/(\d+)\/?$/.exec(t);
  if (boards) return `/boards/${boards[1]}`;
  const postPath = /^\/posts\/(\d+)\/?$/.exec(t);
  if (postPath) return `/posts/${postPath[1]}`;
  return '/posts';
}

function resolveNewPostProjectId(projects, body) {
  if (body._project_form_locked === '1') {
    const lid = parseInt(String(body.project_id != null ? body.project_id : '').trim(), 10);
    if (!Number.isFinite(lid) || lid < 1 || !projects.some((p) => Number(p.id) === lid)) {
      return { ok: false, error: '게시판 정보가 올바르지 않습니다.' };
    }
    return { ok: true, project_id: lid };
  }
  const pid = parseInt(String(body.project_id != null ? body.project_id : '').trim(), 10);
  if (!Number.isFinite(pid) || pid < 1 || !projects.some((p) => Number(p.id) === pid)) {
    return {
      ok: false,
      error: '게시판을 선택해주세요. (-- 분류 없음 -- 은 등록할 수 없습니다.)'
    };
  }
  return { ok: true, project_id: pid };
}

function pickDefaultProjectId(projects, queryProjectId) {
  const qid = parseInt(queryProjectId, 10);
  if (!Number.isFinite(qid) || qid < 1) return null;
  const ok = projects.some((p) => Number(p.id) === qid);
  return ok ? qid : null;
}

const bodyUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 55 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const m = file.mimetype || '';
    const ok =
      /^image\/(jpeg|png|gif|webp)$/i.test(m) ||
      /^video\/(mp4|webm|quicktime)$/i.test(m);
    if (ok) cb(null, true);
    else cb(new Error('JPEG, PNG, GIF, WEBP 이미지 또는 MP4, WEBM 동영상만 업로드할 수 있습니다.'));
  }
});

router.post(
  '/body-upload',
  requireAdmin,
  (req, res, next) => {
    bodyUpload.single('file')(req, res, (err) => {
      if (err) {
        const msg =
          err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
            ? '파일이 최대 55MB를 넘을 수 없습니다.'
            : err.message || '업로드 실패';
        return res.status(400).json({ error: msg });
      }
      next();
    });
  },
  asyncRoute(async (req, res) => {
    if (!req.file || !req.file.buffer || !req.file.buffer.length) {
      return res.status(400).json({ error: '파일이 없습니다.' });
    }
    const mime = verifiedMime(req.file.buffer, IMAGE_MIMES.concat(VIDEO_MIMES));
    if (!mime) {
      return res.status(400).json({ error: '파일 내용이 JPEG, PNG, GIF, WEBP 이미지나 MP4, WEBM 동영상 형식이 아닙니다.' });
    }
    const ins = await db.run('INSERT INTO post_body_assets (mime, data) VALUES (?, ?)', [
      mime,
      req.file.buffer
    ]);
    const id = ins.lastInsertRowid;
    if (id == null) return res.status(500).json({ error: '저장에 실패했습니다.' });
    res.json({ id, url: `/media/post-body/${id}` });
  })
);

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const limit = ALL_POSTS_PAGE_SIZE;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const offset = (page - 1) * limit;

    const totalRow = await db.get('SELECT COUNT(*) as count FROM posts');
    const total = Number(totalRow && totalRow.count != null ? totalRow.count : 0);
    const totalPages = total === 0 ? 1 : Math.ceil(total / limit);
    if (page > totalPages) {
      return res.redirect('/posts?page=' + totalPages);
    }

    const rows = await db.all(
      `
    SELECT p.*, pr.name as project_name, pr.name_ja as project_name_ja,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
      u.nickname AS author_nickname,
      g.global_num
    FROM posts p
    ${POST_GLOBAL_NUM_JOIN}
    LEFT JOIN projects pr ON p.project_id = pr.id
    LEFT JOIN users u ON p.author_id = u.id
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `,
      [limit, offset]
    );

    const posts = rows.map((p) => ({
      ...enrichListPostRow(p),
      project_name_ko_short: truncateBoardNameLine(p.project_name || '', LIST_BOARD_NAME_ALL_POSTS_MAX),
      project_name_ja_short: truncateBoardNameLine(
        p.project_name_ja != null ? String(p.project_name_ja) : '',
        LIST_BOARD_NAME_ALL_POSTS_MAX
      )
    }));

    const paginationItems = buildPaginationItems(page, totalPages);

    const settings = await getSiteSettings();
    const DEFAULT_ALL_POSTS_INTRO_KO = '작성된 모든 게시물을 확인할 수 있는 게시판 입니다.';
    const DEFAULT_ALL_POSTS_INTRO_JA = '作成された全ての投稿を確認できる掲示板です。';
    const allPostsIntroKo =
      settings.all_posts_intro_ko != null && String(settings.all_posts_intro_ko).trim() !== ''
        ? String(settings.all_posts_intro_ko).trim()
        : DEFAULT_ALL_POSTS_INTRO_KO;
    const allPostsIntroJa =
      settings.all_posts_intro_ja != null && String(settings.all_posts_intro_ja).trim() !== ''
        ? String(settings.all_posts_intro_ja).trim()
        : DEFAULT_ALL_POSTS_INTRO_JA;

    res.render('posts', {
      posts,
      page,
      totalPages,
      total,
      pageSize: limit,
      paginationItems,
      settings,
      allPostsIntroKo,
      allPostsIntroJa,
      isAdmin: isUserAdmin(req.session && req.session.user)
    });
  })
);

router.get(
  '/new',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const projects = await db.all('SELECT * FROM projects ORDER BY order_num ASC, name ASC');
    const cancelHref = safeNewPostCancel(req.query.cancel);
    const defaultProjectId = pickDefaultProjectId(projects, req.query.project_id);
    const lockedProject =
      defaultProjectId != null
        ? projects.find((p) => Number(p.id) === Number(defaultProjectId)) || null
        : null;
    const projectSelectLocked = !!lockedProject;
    res.render('post-form', {
      post: null,
      projects,
      formAction: '/posts',
      formMethod: 'POST',
      settings: await getSiteSettings(),
      cancelHref,
      defaultProjectId,
      projectSelectLocked,
      lockedProject,
      editorInitJsonB64: editorInitB64From({ html: '', titleKo: '', titleJa: '' })
    });
  })
);

router.post(
  '/',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const projects = await db.all('SELECT * FROM projects ORDER BY order_num ASC, name ASC');
    const cancelHref = safeEchoCancelHref(req.body._cancel_href);
    const projectResolved = resolveNewPostProjectId(projects, req.body);
    if (!projectResolved.ok) {
      const projectSelectLocked = req.body._project_form_locked === '1';
      const lockedProject = projectSelectLocked
        ? projects.find(
            (p) => Number(p.id) === parseInt(String(req.body.project_id || '').trim(), 10)
          ) || null
        : null;
      return res.render('post-form', {
        post: null,
        projects,
        formAction: '/posts',
        formMethod: 'POST',
        error: projectResolved.error,
        settings: await getSiteSettings(),
        cancelHref,
        defaultProjectId: pickDefaultProjectId(projects, req.body.project_id),
        projectSelectLocked,
        lockedProject,
        editorInitJsonB64: editorInitB64From({
          html: req.body.content != null ? String(req.body.content) : '',
          titleKo: req.body.title,
          titleJa: req.body.title_ja
        })
      });
    }
    const project_id_final = projectResolved.project_id;

    const titleKo = (req.body.title != null ? String(req.body.title) : '').trim();
    const titleJaRaw = req.body.title_ja != null ? String(req.body.title_ja).trim() : '';
    const titleJa = titleJaRaw === '' ? null : titleJaRaw;
    const contentRaw = req.body.content != null ? String(req.body.content) : '';
    const content = sanitizePostHtml(contentRaw);

    if (!titleKo || !isPostContentMeaningful(content)) {
      const projectSelectLocked = req.body._project_form_locked === '1';
      const lockedProject = projectSelectLocked
        ? projects.find((p) => Number(p.id) === Number(project_id_final)) || null
        : null;
      return res.render('post-form', {
        post: null,
        projects,
        formAction: '/posts',
        formMethod: 'POST',
        error: '국문 제목과 본문(또는 첨부 미디어)을 입력해주세요.',
        settings: await getSiteSettings(),
        cancelHref,
        defaultProjectId: projectSelectLocked ? null : pickDefaultProjectId(projects, req.body.project_id),
        projectSelectLocked,
        lockedProject,
        editorInitJsonB64: editorInitB64From({
          html: contentRaw,
          titleKo: req.body.title,
          titleJa: req.body.title_ja
        })
      });
    }

    const authorId = req.session.user && req.session.user.id != null ? req.session.user.id : null;
    const result = await db.run(
      'INSERT INTO posts (title, title_ja, content, project_id, author_id) VALUES (?, ?, ?, ?, ?)',
      [titleKo, titleJa, content, project_id_final, authorId]
    );

    res.redirect(`/posts/${result.lastInsertRowid}`);
  })
);

router.get(
  '/:id/edit',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const post = await db.get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
    if (!post) return res.status(404).render('error', { code: 404, message: '게시물을 찾을 수 없습니다.' });

    const projects = await db.all('SELECT * FROM projects ORDER BY order_num ASC');
    res.render('post-form', {
      post,
      projects,
      formAction: `/posts/${post.id}?_method=PUT`,
      formMethod: 'POST',
      settings: await getSiteSettings(),
      cancelHref: `/posts/${post.id}`,
      editorInitJsonB64: editorInitB64From({
        html: post.content,
        titleKo: post.title,
        titleJa: post.title_ja != null ? post.title_ja : ''
      })
    });
  })
);

router.put(
  '/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const titleKo = (req.body.title != null ? String(req.body.title) : '').trim();
    const titleJaRaw = req.body.title_ja != null ? String(req.body.title_ja).trim() : '';
    const titleJa = titleJaRaw === '' ? null : titleJaRaw;
    const contentRaw = req.body.content != null ? String(req.body.content) : '';
    const content = sanitizePostHtml(contentRaw);
    const { project_id } = req.body;

    const existing = await db.get('SELECT id, content FROM posts WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).render('error', { code: 404, message: '게시물을 찾을 수 없습니다.' });

    const projectResolved = await resolveEditProjectId(project_id);

    if (!titleKo || !isPostContentMeaningful(content) || !projectResolved.ok) {
      const post = await db.get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
      const projects = await db.all('SELECT * FROM projects ORDER BY order_num ASC');
      return res.status(400).render('post-form', {
        post,
        projects,
        formAction: `/posts/${req.params.id}?_method=PUT`,
        formMethod: 'POST',
        error: !projectResolved.ok
          ? '게시판 정보가 올바르지 않습니다. 다시 선택해주세요.'
          : '국문 제목과 본문(또는 첨부 미디어)을 입력해주세요.',
        settings: await getSiteSettings(),
        cancelHref: `/posts/${req.params.id}`,
        defaultProjectId: pickDefaultProjectId(projects, project_id),
        editorInitJsonB64: editorInitB64From({
          html: contentRaw,
          titleKo: req.body.title,
          titleJa: req.body.title_ja
        })
      });
    }

    await db.run(
      'UPDATE posts SET title = ?, title_ja = ?, content = ?, project_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [titleKo, titleJa, content, projectResolved.project_id, req.params.id]
    );
    /* 수정으로 본문에서 빠진 첨부 미디어 정리 */
    const kept = extractAssetIds(content);
    const dropped = [...extractAssetIds(existing.content)].filter((id) => !kept.has(id));
    await deleteAssetsIfUnreferenced(dropped);
    res.redirect(`/posts/${req.params.id}`);
  })
);

router.delete(
  '/:id',
  requireLogin,
  asyncRoute(async (req, res) => {
    const post = await db.get('SELECT author_id, content FROM posts WHERE id = ?', [req.params.id]);
    if (!post) {
      return res.status(404).render('error', { code: 404, message: '게시물을 찾을 수 없습니다.' });
    }
    const isOwner = Number(post.author_id) === Number(req.session.user.id);
    const isAdm = isUserAdmin(req.session.user);
    if (!isOwner && !isAdm) {
      return res.status(403).render('error', { code: 403, message: '이 게시물을 삭제할 권한이 없습니다.' });
    }
    await db.run('DELETE FROM comment_notifications WHERE post_id = ?', [req.params.id]);
    await db.run('DELETE FROM comments WHERE post_id = ?', [req.params.id]);
    await db.run('DELETE FROM posts WHERE id = ?', [req.params.id]);
    await deleteAssetsIfUnreferenced(extractAssetIds(post.content));
    const nextSafe = sanitizeMypageWritingsNext(req.body && req.body.next != null ? req.body.next : '');
    if (nextSafe) return res.redirect(nextSafe);
    res.redirect('/posts');
  })
);

router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const post = await db.get(
      `
    SELECT p.*,
      pr.name AS project_name,
      pr.name_ja AS project_name_ja,
      pr.description AS project_description,
      u.nickname AS author_nickname
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    LEFT JOIN users u ON p.author_id = u.id
    WHERE p.id = ?
  `,
      [req.params.id]
    );

    if (!post) return res.status(404).render('error', { code: 404, message: '게시물을 찾을 수 없습니다.' });

    post.view_count = post.view_count != null ? Number(post.view_count) : 0;
    if (shouldCountView(req, req.params.id)) {
      await db.run('UPDATE posts SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ?', [req.params.id]);
      post.view_count += 1;
    }

    const comments = await db.all(
      `
    SELECT c.*, u.nickname, u.avatar AS user_avatar
    FROM comments c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC, c.id ASC
  `,
      [req.params.id]
    );

    comments.forEach((c) => {
      c.id = Number(c.id);
      c.user_id = Number(c.user_id);
      c.post_id = Number(c.post_id);
      const edited = isEditedAfterCreate(c.created_at, c.updated_at);
      c.comment_edited = edited;
      c.display_time_iso = toIsoUtc(c.updated_at || c.created_at);
      c.display_time_suffix = edited ? ' (수정)' : '';
      c.display_time_line = formatCommentDateTime(c.updated_at || c.created_at) + c.display_time_suffix;
    });

    res.render('post', {
      post,
      comments,
      commentsCount: comments.length,
      settings: await getSiteSettings(),
      contentAsHtml: postContentLooksLikeHtml(post.content),
      postDisplayCreated: formatListTime(post.created_at),
      postDisplayUpdated: formatListTime(post.updated_at),
      postCreatedIso: toIsoUtc(post.created_at),
      postUpdatedIso: toIsoUtc(post.updated_at),
      postEdited: isEditedAfterCreate(post.created_at, post.updated_at)
    });
  })
);

router.post(
  '/:id/comments',
  requireLogin,
  asyncRoute(async (req, res) => {
    const content = sanitizeCommentInput(bodyScalarPreferLast(req.body && req.body.content));
    if (!content) return res.redirect(`/posts/${req.params.id}#comments`);

    const postId = Number(req.params.id);
    const userId = Number(req.session.user.id);
    if (!Number.isFinite(userId) || userId < 1) {
      return res.redirect('/auth/login?next=' + encodeURIComponent(`/posts/${postId}`));
    }
    const postExists = await db.get('SELECT id FROM posts WHERE id = ?', [postId]);
    if (!postExists) {
      return res.status(404).render('error', { code: 404, message: '게시물을 찾을 수 없습니다.' });
    }

    /*
     * PG·SQLite 공통: 타임스탬프는 CURRENT_TIMESTAMP로 두 DB에서 동일 처리.
     */
    const ins = await db.run(
      'INSERT INTO comments (post_id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
      [postId, userId, content]
    );

    const newCommentId =
      ins && ins.lastInsertRowid != null && Number.isFinite(Number(ins.lastInsertRowid))
        ? Number(ins.lastInsertRowid)
        : null;
    if (newCommentId != null) {
      try {
        await createCommentNotification(db, postId, newCommentId, userId);
      } catch (_) {
        /* 테이블 미구성 등 — 댓글은 유지 */
      }
    }

    res.redirect(`/posts/${req.params.id}#comments`);
  })
);

router.put(
  '/:postId/comments/:commentId',
  requireLogin,
  asyncRoute(async (req, res) => {
    const content = sanitizeCommentInput(bodyScalarPreferLast(req.body && req.body.content));
    if (!content) return res.redirect(`/posts/${req.params.postId}#comments`);

    const row = await db.get(
      'SELECT user_id FROM comments WHERE id = ? AND post_id = ?',
      [req.params.commentId, req.params.postId]
    );
    if (!row) return res.status(404).render('error', { code: 404, message: '댓글을 찾을 수 없습니다.' });
    if (Number(row.user_id) !== Number(req.session.user.id)) {
      return res.status(403).render('error', { code: 403, message: '본인 댓글만 수정할 수 있습니다.' });
    }

    await db.run(
      'UPDATE comments SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND post_id = ?',
      [content, req.params.commentId, req.params.postId]
    );
    res.redirect(`/posts/${req.params.postId}#comments`);
  })
);

router.delete(
  '/:postId/comments/:commentId',
  requireLogin,
  asyncRoute(async (req, res) => {
    const row = await db.get(
      'SELECT user_id FROM comments WHERE id = ? AND post_id = ?',
      [req.params.commentId, req.params.postId]
    );
    if (!row) return res.redirect(`/posts/${req.params.postId}#comments`);

    const isOwner = Number(row.user_id) === Number(req.session.user.id);
    const isAdm = isUserAdmin(req.session.user);
    if (!isOwner && !isAdm) {
      return res.status(403).render('error', { code: 403, message: '이 댓글을 삭제할 권한이 없습니다.' });
    }

    await db.run('DELETE FROM comments WHERE id = ? AND post_id = ?', [
      req.params.commentId,
      req.params.postId
    ]);
    const nextSafe = sanitizeMypageWritingsNext(req.body && req.body.next != null ? req.body.next : '');
    if (nextSafe) return res.redirect(nextSafe);
    res.redirect(`/posts/${req.params.postId}#comments`);
  })
);

module.exports = router;
