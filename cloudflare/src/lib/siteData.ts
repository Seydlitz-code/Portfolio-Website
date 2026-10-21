/**
 * 메인·목록 화면 공통 데이터 (기존 lib/siteData.js 이식).
 */
import {
  formatListTime,
  toIsoUtc,
  truncateBoardNameLine,
  truncatePostTitleLine
} from './time';

export const KIND_SITE_PROFILE_IMAGE = 'site_profile_image';
export const SITE_PROFILE_IMAGE_URL = '/media/site/profile-image';
export const DEFAULT_SITE_NAME = 'Donghawan Lee / @lilip';

/**
 * 전체 게시물 기준 글 번호(오래된 글 = 1). 별칭 g.global_num.
 * 행마다 COUNT 하위 쿼리를 돌리지 않고 윈도 함수 한 번으로 계산한다.
 */
export const POST_GLOBAL_NUM_JOIN = `JOIN (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS global_num FROM posts
) g ON g.id = p.id`;

export type Settings = Record<string, string>;

export type Project = {
  id: number;
  name: string;
  name_ja: string | null;
  description: string | null;
  order_num: number;
  created_at: string;
};

export type PostRow = {
  id: number;
  title: string;
  title_ja: string | null;
  content: string;
  project_id: number | null;
  author_id: number | null;
  view_count: number;
  created_at: string;
  updated_at: string;
  project_name?: string | null;
  project_name_ja?: string | null;
  author_nickname?: string | null;
  comment_count?: number;
  global_num?: number;
};

export type ListPost = PostRow & {
  created_at_iso: string;
  display_time: string;
  title_ko_short: string;
  title_ja_short: string;
  project_name_ko_short: string;
  project_name_ja_short: string;
};

export function enrichListPostRow(p: PostRow, boardNameMax?: number): ListPost {
  return {
    ...p,
    created_at_iso: toIsoUtc(p.created_at),
    display_time: formatListTime(p.created_at),
    view_count: Number(p.view_count ?? 0),
    comment_count: Number(p.comment_count ?? 0),
    global_num: Number(p.global_num ?? 0),
    title_ko_short: truncatePostTitleLine(p.title),
    title_ja_short: truncatePostTitleLine(p.title_ja ?? ''),
    project_name_ko_short: truncateBoardNameLine(p.project_name ?? '', boardNameMax),
    project_name_ja_short: truncateBoardNameLine(p.project_name_ja ?? '', boardNameMax)
  };
}

export async function getSiteSettings(db: D1Database): Promise<Settings> {
  const [rows, img] = await db.batch<{ key?: string; value?: string; kind?: string }>([
    db.prepare('SELECT key, value FROM site_settings'),
    db.prepare('SELECT kind FROM site_assets WHERE kind = ?').bind(KIND_SITE_PROFILE_IMAGE)
  ]);
  const settings: Settings = {};
  for (const r of rows.results) settings[String(r.key)] = r.value ?? '';
  settings.profile_image = img.results.length ? SITE_PROFILE_IMAGE_URL : '';
  return settings;
}

export async function upsertSiteSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .bind(key, value)
    .run();
}

export type HomeData = {
  settings: Settings;
  recentPosts: ListPost[];
  projects: (Project & { posts: ListPost[] })[];
};

/** 메인 화면: 최근 5개 + 게시판별 최신 5개 (게시판 수만큼 반복 조회하지 않고 한 번에) */
export async function getSiteHomeData(db: D1Database): Promise<HomeData> {
  const [recent, projects, perBoard] = await db.batch([
    db.prepare(`
      SELECT p.*, pr.name AS project_name, pr.name_ja AS project_name_ja,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
        u.nickname AS author_nickname,
        g.global_num
      FROM posts p
      ${POST_GLOBAL_NUM_JOIN}
      LEFT JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN users u ON p.author_id = u.id
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 5`),
    db.prepare('SELECT * FROM projects ORDER BY order_num ASC, created_at DESC'),
    db.prepare(`
      SELECT * FROM (
        SELECT p.*,
          (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
          u.nickname AS author_nickname,
          g.global_num,
          ROW_NUMBER() OVER (PARTITION BY p.project_id ORDER BY p.created_at DESC, p.id DESC) AS board_rank
        FROM posts p
        ${POST_GLOBAL_NUM_JOIN}
        LEFT JOIN users u ON p.author_id = u.id
        WHERE p.project_id IS NOT NULL
      ) ranked
      WHERE board_rank <= 5
      ORDER BY created_at DESC, id DESC`)
  ]);

  const byProject = new Map<number, ListPost[]>();
  for (const row of perBoard.results as PostRow[]) {
    const key = Number(row.project_id);
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(enrichListPostRow(row));
  }

  return {
    settings: await getSiteSettings(db),
    recentPosts: (recent.results as PostRow[]).map((r) => enrichListPostRow(r)),
    projects: (projects.results as Project[]).map((p) => ({ ...p, posts: byProject.get(Number(p.id)) ?? [] }))
  };
}
