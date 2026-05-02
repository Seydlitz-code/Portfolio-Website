const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { getSiteSettings } = require('../lib/siteData');
const { formatListTime, buildPaginationItems } = require('../lib/listingHelpers');

const PAGE_SIZE = 200;

router.get('/:projectId', (req, res) => {
  const db = getDb();
  const projectId = parseInt(req.params.projectId, 10);
  if (!Number.isFinite(projectId)) {
    return res.status(404).render('error', { code: 404, message: '게시판을 찾을 수 없습니다.' });
  }

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    return res.status(404).render('error', { code: 404, message: '게시판을 찾을 수 없습니다.' });
  }

  const total = db.prepare('SELECT COUNT(*) as c FROM posts WHERE project_id = ?').get(projectId).c;
  const totalPages = total === 0 ? 1 : Math.ceil(total / PAGE_SIZE);
  let page = Math.max(1, parseInt(req.query.page, 10) || 1);
  if (page > totalPages) {
    return res.redirect(`/boards/${projectId}?page=${totalPages}`);
  }

  const offset = (page - 1) * PAGE_SIZE;
  const rows = db
    .prepare(
      `
    SELECT p.*,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
      u.nickname AS author_nickname
    FROM posts p
    LEFT JOIN users u ON p.author_id = u.id
    WHERE p.project_id = ?
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `
    )
    .all(projectId, PAGE_SIZE, offset);

  const posts = rows.map((p) => ({
    ...p,
    display_time: formatListTime(p.created_at),
    view_count: p.view_count != null ? Number(p.view_count) : 0,
    comment_count: p.comment_count != null ? Number(p.comment_count) : 0
  }));

  const settings = getSiteSettings();
  const paginationItems = buildPaginationItems(page, totalPages);

  res.render('board', {
    settings,
    project,
    posts,
    page,
    totalPages,
    total,
    pageSize: PAGE_SIZE,
    paginationItems
  });
});

module.exports = router;
