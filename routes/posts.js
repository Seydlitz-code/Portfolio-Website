const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../lib/db');
const { requireAdmin, requireLogin, isUserAdmin } = require('../middleware/auth');
const { getSiteSettings } = require('../lib/siteData');
const { formatListTime, buildPaginationItems } = require('../lib/listingHelpers');
const { asyncRoute } = require('../lib/asyncRoute');
const { sanitizePostHtml, isPostContentMeaningful, postContentLooksLikeHtml } = require('../lib/postHtml');

const ALL_POSTS_PAGE_SIZE = 200;

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
  const t = queryCancel.trim();
  if (!t.startsWith('/boards/')) return '/posts';
  const rest = t.slice('/boards/'.length).split('?')[0];
  const id = parseInt(rest, 10);
  if (!Number.isFinite(id) || id < 1) return '/posts';
  return `/boards/${id}`;
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
    SELECT p.*, pr.name as project_name,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
      u.nickname AS author_nickname
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    LEFT JOIN users u ON p.author_id = u.id
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `,
      [limit, offset]
    );

    const posts = rows.map((p) => ({
      ...p,
      display_time: formatListTime(p.created_at),
      view_count: p.view_count != null ? Number(p.view_count) : 0,
      comment_count: p.comment_count != null ? Number(p.comment_count) : 0
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
    res.render('post-form', {
      post: null,
      projects,
      formAction: '/posts',
      formMethod: 'POST',
      settings: await getSiteSettings(),
      cancelHref,
      defaultProjectId,
      editorInitJsonB64: editorInitB64From({ html: '', titleKo: '', titleJa: '' })
    });
  })
);

router.post(
  '/',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const titleKo = (req.body.title != null ? String(req.body.title) : '').trim();
    const titleJaRaw = req.body.title_ja != null ? String(req.body.title_ja).trim() : '';
    const titleJa = titleJaRaw === '' ? null : titleJaRaw;
    const contentRaw = req.body.content != null ? String(req.body.content) : '';
    const content = sanitizePostHtml(contentRaw);
    const { project_id } = req.body;

    if (!titleKo || !isPostContentMeaningful(content)) {
      const projects = await db.all('SELECT * FROM projects ORDER BY order_num ASC');
      return res.render('post-form', {
        post: null,
        projects,
        formAction: '/posts',
        formMethod: 'POST',
        error: '국문 제목과 본문(또는 첨부 미디어)을 입력해주세요.',
        settings: await getSiteSettings(),
        cancelHref: '/posts',
        defaultProjectId: pickDefaultProjectId(projects, req.body.project_id),
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
      [titleKo, titleJa, content, project_id || null, authorId]
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
    SELECT p.*, pr.name as project_name
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    WHERE p.id = ?
  `,
      [req.params.id]
    );

    if (!post) return res.status(404).render('error', { code: 404, message: '게시물을 찾을 수 없습니다.' });

    await db.run('UPDATE posts SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ?', [req.params.id]);
    post.view_count = (post.view_count != null ? Number(post.view_count) : 0) + 1;

    const comments = await db.all(
      `
    SELECT c.*, u.nickname
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
  `,
      [req.params.id]
    );

    res.render('post', {
      post,
      comments,
      settings: await getSiteSettings(),
      contentAsHtml: postContentLooksLikeHtml(post.content)
    });
  })
);

router.post(
  '/:id/comments',
  requireLogin,
  asyncRoute(async (req, res) => {
    const { content } = req.body;
    if (!content || !content.trim()) return res.redirect(`/posts/${req.params.id}`);

    await db.run('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)', [
      req.params.id,
      req.session.user.id,
      content.trim()
    ]);

    res.redirect(`/posts/${req.params.id}#comments`);
  })
);

router.delete(
  '/:postId/comments/:commentId',
  requireAdmin,
  asyncRoute(async (req, res) => {
    await db.run('DELETE FROM comments WHERE id = ? AND post_id = ?', [
      req.params.commentId,
      req.params.postId
    ]);
    res.redirect(`/posts/${req.params.postId}#comments`);
  })
);

module.exports = router;
