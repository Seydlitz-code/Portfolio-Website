const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { getSiteSettings } = require('../lib/siteData');
const { formatListTime, buildPaginationItems } = require('../lib/listingHelpers');
const { asyncRoute } = require('../lib/asyncRoute');
const { isUserAdmin } = require('../middleware/auth');

const PAGE_SIZE = 200;

router.get(
  '/:projectId',
  asyncRoute(async (req, res) => {
    const projectId = parseInt(req.params.projectId, 10);
    if (!Number.isFinite(projectId)) {
      return res.status(404).render('error', { code: 404, message: '게시판을 찾을 수 없습니다.' });
    }

    const project = await db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
    if (!project) {
      return res.status(404).render('error', { code: 404, message: '게시판을 찾을 수 없습니다.' });
    }

    const totalRow = await db.get('SELECT COUNT(*) as c FROM posts WHERE project_id = ?', [projectId]);
    const total = Number(totalRow && totalRow.c != null ? totalRow.c : 0);
    const totalPages = total === 0 ? 1 : Math.ceil(total / PAGE_SIZE);
    let page = Math.max(1, parseInt(req.query.page, 10) || 1);
    if (page > totalPages) {
      return res.redirect(`/boards/${projectId}?page=${totalPages}`);
    }

    const offset = (page - 1) * PAGE_SIZE;
    const rows = await db.all(
      `
    SELECT p.*,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
      u.nickname AS author_nickname
    FROM posts p
    LEFT JOIN users u ON p.author_id = u.id
    WHERE p.project_id = ?
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `,
      [projectId, PAGE_SIZE, offset]
    );

    const posts = rows.map((p) => ({
      ...p,
      display_time: formatListTime(p.created_at),
      view_count: p.view_count != null ? Number(p.view_count) : 0,
      comment_count: p.comment_count != null ? Number(p.comment_count) : 0
    }));

    const settings = await getSiteSettings();
    const paginationItems = buildPaginationItems(page, totalPages);

    res.render('board', {
      settings,
      project,
      posts,
      page,
      totalPages,
      total,
      pageSize: PAGE_SIZE,
      paginationItems,
      isAdmin: isUserAdmin(req.session && req.session.user)
    });
  })
);

module.exports = router;
