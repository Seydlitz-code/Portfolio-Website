/** 게시판별 목록 (기존 routes/boards.js 이식) */
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { BoardPage } from '../views/lists';
import { navData, renderError } from '../lib/http';
import { parseId } from '../lib/ids';
import { enrichListPostRow, getSiteSettings, POST_GLOBAL_NUM_JOIN, type PostRow, type Project } from '../lib/siteData';
import { buildPaginationItems, pageParam } from '../lib/time';

const PAGE_SIZE = 200;

const boards = new Hono<AppEnv>();

boards.get('/:projectId', async (c) => {
  const db = c.env.DB;
  const projectId = parseId(c.req.param('projectId'));
  const project = projectId
    ? await db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first<Project>()
    : null;
  if (!project || projectId == null) return renderError(c, 404, '게시판을 찾을 수 없습니다.');

  const total = Number(
    (await db.prepare('SELECT COUNT(*) AS n FROM posts WHERE project_id = ?').bind(projectId).first<{ n: number }>())?.n ?? 0
  );
  const totalPages = total === 0 ? 1 : Math.ceil(total / PAGE_SIZE);
  const page = pageParam(c.req.query('page'));
  if (page > totalPages) return c.redirect(`/boards/${projectId}?page=${totalPages}`);

  const { results } = await db
    .prepare(
      `SELECT p.*,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
         u.nickname AS author_nickname,
         g.global_num
       FROM posts p
       ${POST_GLOBAL_NUM_JOIN}
       LEFT JOIN users u ON p.author_id = u.id
       WHERE p.project_id = ?
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(projectId, PAGE_SIZE, (page - 1) * PAGE_SIZE)
    .all<PostRow>();

  const settings = await getSiteSettings(db);
  return c.html(
    <BoardPage
      nav={await navData(c, settings)}
      project={project}
      posts={results.map((r) => enrichListPostRow(r))}
      page={page}
      totalPages={totalPages}
      paginationItems={buildPaginationItems(page, totalPages)}
    />
  );
});

export default boards;
