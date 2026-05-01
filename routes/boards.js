const express = require('express');
const router = express.Router();
const { getDb } = require('../config/database');
const { getSiteSettings } = require('../lib/siteData');

const PAGE_SIZE = 20;

function formatBoardListTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mi}`;
  }
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}.${mm}.${dd}`;
}

/**
 * 페이지 번호 링크용 배열 (ellipsis 포함)
 */
function buildPaginationItems(current, total) {
  if (total <= 1) {
    return [{ type: 'page', n: 1, current: current === 1 }];
  }
  const items = [];
  const pushPage = (n) => {
    items.push({ type: 'page', n, current: n === current });
  };
  const pushEllipsis = () => {
    if (items.length && items[items.length - 1].type !== 'ellipsis') {
      items.push({ type: 'ellipsis' });
    }
  };

  if (total <= 11) {
    for (let i = 1; i <= total; i += 1) pushPage(i);
    return items;
  }

  pushPage(1);
  const left = Math.max(2, current - 2);
  const right = Math.min(total - 1, current + 2);

  if (left > 2) pushEllipsis();
  for (let i = left; i <= right; i += 1) pushPage(i);
  if (right < total - 1) pushEllipsis();
  pushPage(total);
  return items;
}

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
    display_time: formatBoardListTime(p.created_at),
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
