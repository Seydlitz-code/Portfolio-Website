const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { requireAdmin, requireLogin } = require('../middleware/auth');
const { getSiteSettings } = require('../lib/siteData');
const { formatListTime, buildPaginationItems } = require('../lib/listingHelpers');

const ALL_POSTS_PAGE_SIZE = 200;

// GET /posts - All posts
router.get('/', (req, res) => {
  const db = getDb();
  const limit = ALL_POSTS_PAGE_SIZE;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as count FROM posts').get().count;
  const totalPages = total === 0 ? 1 : Math.ceil(total / limit);
  if (page > totalPages) {
    return res.redirect('/posts?page=' + totalPages);
  }

  const rows = db
    .prepare(
      `
    SELECT p.*, pr.name as project_name,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
      u.nickname AS author_nickname
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    LEFT JOIN users u ON p.author_id = u.id
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `
    )
    .all(limit, offset);

  const posts = rows.map((p) => ({
    ...p,
    display_time: formatListTime(p.created_at),
    view_count: p.view_count != null ? Number(p.view_count) : 0,
    comment_count: p.comment_count != null ? Number(p.comment_count) : 0
  }));

  const paginationItems = buildPaginationItems(page, totalPages);

  const settings = getSiteSettings();
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
    allPostsIntroJa
  });
});

// GET /posts/new - Create form (admin only)
router.get('/new', requireAdmin, (req, res) => {
  const db = getDb();
  const projects = db.prepare('SELECT * FROM projects ORDER BY order_num ASC, name ASC').all();
  res.render('post-form', {
    post: null,
    projects,
    formAction: '/posts',
    formMethod: 'POST',
    settings: getSiteSettings()
  });
});

// POST /posts - Create post (admin only)
router.post('/', requireAdmin, (req, res) => {
  const { title, content, project_id } = req.body;
  if (!title || !content) {
    const db = getDb();
    const projects = db.prepare('SELECT * FROM projects ORDER BY order_num ASC').all();
    return res.render('post-form', {
      post: null, projects,
      formAction: '/posts', formMethod: 'POST',
      error: '제목과 내용을 입력해주세요.',
      settings: getSiteSettings()
    });
  }

  const db = getDb();
  const authorId = req.session.user && req.session.user.id != null ? req.session.user.id : null;
  const result = db.prepare(
    'INSERT INTO posts (title, content, project_id, author_id) VALUES (?, ?, ?, ?)'
  ).run(title, content, project_id || null, authorId);

  res.redirect(`/posts/${result.lastInsertRowid}`);
});

// GET /posts/:id/edit - Edit form (admin only)
router.get('/:id/edit', requireAdmin, (req, res) => {
  const db = getDb();
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).render('error', { code: 404, message: '게시물을 찾을 수 없습니다.' });

  const projects = db.prepare('SELECT * FROM projects ORDER BY order_num ASC').all();
  res.render('post-form', {
    post,
    projects,
    formAction: `/posts/${post.id}?_method=PUT`,
    formMethod: 'POST',
    settings: getSiteSettings()
  });
});

// PUT /posts/:id - Update post (admin only)
router.put('/:id', requireAdmin, (req, res) => {
  const { title, content, project_id } = req.body;
  const db = getDb();
  db.prepare(
    'UPDATE posts SET title = ?, content = ?, project_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).run(title, content, project_id || null, req.params.id);
  res.redirect(`/posts/${req.params.id}`);
});

// DELETE /posts/:id - Delete post (admin only)
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM comments WHERE post_id = ?').run(req.params.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  res.redirect('/posts');
});

// GET /posts/:id - Single post view
router.get('/:id', (req, res) => {
  const db = getDb();
  const post = db.prepare(`
    SELECT p.*, pr.name as project_name
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    WHERE p.id = ?
  `).get(req.params.id);

  if (!post) return res.status(404).render('error', { code: 404, message: '게시물을 찾을 수 없습니다.' });

  db.prepare('UPDATE posts SET view_count = COALESCE(view_count, 0) + 1 WHERE id = ?').run(req.params.id);
  post.view_count = (post.view_count != null ? Number(post.view_count) : 0) + 1;

  const comments = db.prepare(`
    SELECT c.*, u.nickname
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.post_id = ?
    ORDER BY c.created_at ASC
  `).all(req.params.id);

  res.render('post', { post, comments, settings: getSiteSettings() });
});

// POST /posts/:id/comments - Add comment (login required)
router.post('/:id/comments', requireLogin, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.redirect(`/posts/${req.params.id}`);

  const db = getDb();
  db.prepare(
    'INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)'
  ).run(req.params.id, req.session.user.id, content.trim());

  res.redirect(`/posts/${req.params.id}#comments`);
});

// DELETE /posts/:postId/comments/:commentId - Delete comment (admin only)
router.delete('/:postId/comments/:commentId', requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM comments WHERE id = ? AND post_id = ?').run(
    req.params.commentId, req.params.postId
  );
  res.redirect(`/posts/${req.params.postId}#comments`);
});

module.exports = router;
