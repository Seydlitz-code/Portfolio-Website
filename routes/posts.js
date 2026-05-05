const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../lib/db');
const { requireAdmin, requireLogin, isUserAdmin } = require('../middleware/auth');
const { getSiteSettings } = require('../lib/siteData');
const {
  formatListTime,
  buildPaginationItems,
  truncatePostTitleLine,
  truncateBoardNameLine,
  LIST_BOARD_NAME_ALL_POSTS_MAX
} = require('../lib/listingHelpers');

function isPostEdited(createdAt, updatedAt) {
  if (!createdAt || !updatedAt) return false;
  const c = new Date(createdAt).getTime();
  const u = new Date(updatedAt).getTime();
  if (Number.isNaN(c) || Number.isNaN(u)) return false;
  return u - c > 2000;
}
const { asyncRoute } = require('../lib/asyncRoute');
const { sanitizePostHtml, isPostContentMeaningful, postContentLooksLikeHtml } = require('../lib/postHtml');

const ALL_POSTS_PAGE_SIZE = 200;

function formatCommentDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function sanitizeCommentInput(raw) {
  let s = raw != null ? String(raw) : '';
  s = s.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
  if (s.length > 100) s = s.slice(0, 100);
  /* textarea·스크립트 경계 문자열로 인한 마크업 깨짐·서버 템플릿 오류 방지 */
  s = s.replace(/<\/textarea\b/gi, '');
  s = s.replace(/<\/script\b/gi, '');
  return s;
}

/** 평면 댓글 목록 → parent_id 기준 트리 (부모는 최상위 댓글만 허용, 그 외·순환은 루트로) */
function nestCommentRows(rows) {
  const byId = new Map();
  for (const r of rows) {
    const idNum = Number(r.id);
    if (!Number.isFinite(idNum)) continue;
    byId.set(idNum, { ...r, id: idNum, user_id: Number(r.user_id), replies: [] });
  }
  const roots = [];
  for (const r of rows) {
    const idNum = Number(r.id);
    const node = byId.get(idNum);
    if (!node) continue;
    const rawPid = r.parent_id;
    const pid = rawPid != null && rawPid !== '' ? Number(rawPid) : NaN;
    const parentNode = Number.isFinite(pid) && pid !== idNum ? byId.get(pid) : null;
    const parentIsRoot =
      parentNode &&
      (parentNode.parent_id == null ||
        parentNode.parent_id === '' ||
        Number(parentNode.parent_id) === 0);
    if (parentNode && parentIsRoot) {
      parentNode.replies.push(node);
    } else {
      roots.push(node);
    }
  }
  const cmp = (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  roots.sort(cmp);
  byId.forEach((n) => {
    n.replies.sort(cmp);
  });
  return roots;
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
    const ins = await db.run('INSERT INTO post_body_assets (mime, data) VALUES (?, ?)', [
      req.file.mimetype,
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
      (
        (SELECT COUNT(*) FROM posts) -
        (
          SELECT COUNT(*) FROM posts p2
          WHERE (p2.created_at > p.created_at)
             OR (p2.created_at = p.created_at AND p2.id > p.id)
        )
      ) AS global_num
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    LEFT JOIN users u ON p.author_id = u.id
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ? OFFSET ?
  `,
      [limit, offset]
    );

    const posts = rows.map((p) => ({
      ...p,
      display_time: formatListTime(p.created_at),
      view_count: p.view_count != null ? Number(p.view_count) : 0,
      comment_count: p.comment_count != null ? Number(p.comment_count) : 0,
      global_num: p.global_num != null ? Number(p.global_num) : 0,
      title_ko_short: truncatePostTitleLine(p.title),
      title_ja_short: truncatePostTitleLine(p.title_ja != null ? p.title_ja : ''),
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

    if (!titleKo || !isPostContentMeaningful(content)) {
      const post = await db.get('SELECT * FROM posts WHERE id = ?', [req.params.id]);
      const projects = await db.all('SELECT * FROM projects ORDER BY order_num ASC');
      return res.render('post-form', {
        post: post || {
          id: req.params.id,
          title: titleKo,
          title_ja: titleJa,
          content: contentRaw,
          project_id: project_id || null
        },
        projects,
        formAction: `/posts/${req.params.id}?_method=PUT`,
        formMethod: 'POST',
        error: '국문 제목과 본문(또는 첨부 미디어)을 입력해주세요.',
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
      [titleKo, titleJa, content, project_id || null, req.params.id]
    );
    res.redirect(`/posts/${req.params.id}`);
  })
);

router.delete(
  '/:id',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await db.run('DELETE FROM comments WHERE post_id = ?', [req.params.id]);
    await db.run('DELETE FROM posts WHERE id = ?', [req.params.id]);
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

    await db.run('UPDATE posts SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ?', [req.params.id]);
    post.view_count = (post.view_count != null ? Number(post.view_count) : 0) + 1;

    const comments = await db.all(
      `
    SELECT c.*, u.nickname, u.avatar AS user_avatar
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
  `,
      [req.params.id]
    );

    comments.forEach((c) => {
      c.id = Number(c.id);
      c.user_id = Number(c.user_id);
      c.post_id = Number(c.post_id);
      if (c.parent_id != null && c.parent_id !== '') c.parent_id = Number(c.parent_id);
      else c.parent_id = null;
      const edited = isPostEdited(c.created_at, c.updated_at);
      c.comment_edited = edited;
      c.display_time_line =
        formatCommentDateTime(c.updated_at || c.created_at) + (edited ? ' (수정)' : '');
    });
    const commentTree = nestCommentRows(comments);

    res.render('post', {
      post,
      comments,
      commentTree,
      commentsCount: comments.length,
      settings: await getSiteSettings(),
      contentAsHtml: postContentLooksLikeHtml(post.content),
      postDisplayCreated: formatListTime(post.created_at),
      postDisplayUpdated: formatListTime(post.updated_at),
      postEdited: isPostEdited(post.created_at, post.updated_at)
    });
  })
);

router.post(
  '/:id/comments',
  requireLogin,
  asyncRoute(async (req, res) => {
    const content = sanitizeCommentInput(req.body.content);
    if (!content) return res.redirect(`/posts/${req.params.id}#comments`);

    let parentId = null;
    const rawParent = req.body.parent_id != null ? String(req.body.parent_id).trim() : '';
    if (rawParent !== '') {
      const p = parseInt(rawParent, 10);
      if (Number.isFinite(p) && p > 0) {
        const parent = await db.get(
          'SELECT id, post_id, parent_id FROM comments WHERE id = ?',
          [p]
        );
        if (
          parent &&
          Number(parent.post_id) === Number(req.params.id) &&
          (parent.parent_id == null || Number(parent.parent_id) === 0)
        ) {
          parentId = p;
        }
      }
    }

    const ts = new Date().toISOString();
    const postId = Number(req.params.id);
    const userId = Number(req.session.user.id);
    if (!Number.isFinite(postId) || postId < 1 || !Number.isFinite(userId) || userId < 1) {
      return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl || '/posts'));
    }
    const parentSql = parentId == null || !Number.isFinite(Number(parentId)) ? null : Number(parentId);
    await db.run(
      'INSERT INTO comments (post_id, user_id, content, parent_id, updated_at) VALUES (?, ?, ?, ?, ?)',
      [postId, userId, content, parentSql, ts]
    );

    res.redirect(`/posts/${req.params.id}#comments`);
  })
);

router.put(
  '/:postId/comments/:commentId',
  requireLogin,
  asyncRoute(async (req, res) => {
    const content = sanitizeCommentInput(req.body.content);
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
    const nextRaw = req.body && req.body.next != null ? String(req.body.next).trim() : '';
    if (nextRaw === '/mypage/posts') {
      return res.redirect('/mypage/posts');
    }
    res.redirect(`/posts/${req.params.postId}#comments`);
  })
);

module.exports = router;
