/** 게시판별 목록 (기존 routes/boards.js 이식) */
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { BoardPage } from '../views/lists';
import { buildNavData, renderError } from '../lib/http';
import { parseId } from '../lib/ids';
import {
  buildSettingsStatements,
  enrichListPostRow,
  parseSettingsResults,
  POST_GLOBAL_NUM_JOIN,
  LIST_POST_COLUMNS,
  type ListPostRow,
  type Project
} from '../lib/siteData';
import { buildPaginationItems, countPages, parsePageParam } from '../lib/time';

/** 게시판 목록 한 페이지 크기 (기존 서버와 같음) */
const BOARD_PAGE_SIZE = 200;

const boards = new Hono<AppEnv>();

boards.get('/:projectId', async (c) => {
  const db = c.env.DB;
  const projectId = parseId(c.req.param('projectId'));
  if (projectId == null) return renderError(c, 404, '게시판을 찾을 수 없습니다.');
  const page = parsePageParam(c.req.query('page'));

  // 게시판·개수·목록·설정을 한 번에 가져온다. 페이지가 범위를 벗어나면 아래에서 마지막 페이지로 보낸다.
  const [projectRes, countRes, listRes, settingRows, settingImageRes] = await db.batch([
    db.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId),
    db.prepare('SELECT COUNT(*) AS count FROM posts WHERE project_id = ?').bind(projectId),
    db
      .prepare(
        `SELECT ${LIST_POST_COLUMNS},
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
      .bind(projectId, BOARD_PAGE_SIZE, (page - 1) * BOARD_PAGE_SIZE),
    ...buildSettingsStatements(db)
  ]);
  const project = projectRes.results[0] as Project | undefined;
  if (!project) return renderError(c, 404, '게시판을 찾을 수 없습니다.');

  const total = Number((countRes.results[0] as { count: number } | undefined)?.count ?? 0);
  const totalPages = countPages(total, BOARD_PAGE_SIZE);
  if (page > totalPages) return c.redirect(`/boards/${projectId}?page=${totalPages}`);

  const settings = parseSettingsResults(settingRows, settingImageRes);
  return c.html(
    <BoardPage
      nav={await buildNavData(c, settings)}
      project={project}
      posts={(listRes.results as ListPostRow[]).map((row) => enrichListPostRow(row))}
      page={page}
      totalPages={totalPages}
      paginationItems={buildPaginationItems(page, totalPages)}
    />
  );
});

export default boards;
