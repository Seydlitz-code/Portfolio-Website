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

/**
 * 목록 화면에 필요한 게시물 컬럼. 본문(content)은 수 MB가 될 수 있어 목록에서는 읽지 않는다.
 * posts 별칭이 p인 쿼리에서 SELECT 목록에 넣어 쓴다.
 */
export const LIST_POST_COLUMNS =
  'p.id, p.title, p.title_ja, p.project_id, p.author_id, p.view_count, p.created_at, p.updated_at';

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

/** 목록 쿼리 결과 한 행 (LIST_POST_COLUMNS + 조인 컬럼, 본문 없음) */
export type ListPostRow = Omit<PostRow, 'content'>;

export type ListPost = ListPostRow & {
  created_at_iso: string;
  display_time: string;
  title_ko_short: string;
  title_ja_short: string;
  project_name_ko_short: string;
  project_name_ja_short: string;
};

export function enrichListPostRow(row: ListPostRow, boardNameMax?: number): ListPost {
  return {
    ...row,
    created_at_iso: toIsoUtc(row.created_at),
    display_time: formatListTime(row.created_at),
    view_count: Number(row.view_count ?? 0),
    comment_count: Number(row.comment_count ?? 0),
    global_num: Number(row.global_num ?? 0),
    title_ko_short: truncatePostTitleLine(row.title),
    title_ja_short: truncatePostTitleLine(row.title_ja ?? ''),
    project_name_ko_short: truncateBoardNameLine(row.project_name ?? '', boardNameMax),
    project_name_ja_short: truncateBoardNameLine(row.project_name_ja ?? '', boardNameMax)
  };
}

/**
 * 사이트 설정을 읽는 쿼리 2개. 화면에 필요한 다른 쿼리와 한 번의 db.batch로 묶을 수 있도록
 * 쿼리와 결과 해석을 나눠 둔다 (D1 왕복 횟수 절약).
 */
export function buildSettingsStatements(db: D1Database): [D1PreparedStatement, D1PreparedStatement] {
  return [
    db.prepare('SELECT key, value FROM site_settings'),
    db.prepare('SELECT kind FROM site_assets WHERE kind = ?').bind(KIND_SITE_PROFILE_IMAGE)
  ];
}

export function parseSettingsResults(rows: D1Result<unknown>, imageRes: D1Result<unknown>): Settings {
  const settings: Settings = {};
  for (const row of rows.results as { key: string; value: string | null }[]) settings[row.key] = row.value ?? '';
  settings.profile_image = imageRes.results.length ? SITE_PROFILE_IMAGE_URL : '';
  return settings;
}

export async function getSiteSettings(db: D1Database): Promise<Settings> {
  const [rows, imageRes] = await db.batch(buildSettingsStatements(db));
  return parseSettingsResults(rows, imageRes);
}

/** 사이트 설정 한 항목 저장 (있으면 덮어씀) */
export const UPSERT_SETTING_SQL =
  'INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value';

type HomeData = {
  settings: Settings;
  recentPosts: ListPost[];
  projects: (Project & { posts: ListPost[] })[];
};

/**
 * 메인 화면: 최근 5개 + 게시판별 최신 5개 (게시판 수만큼 반복 조회하지 않고 한 번에).
 * 댓글 수 하위 쿼리는 보여 줄 행을 먼저 고른 뒤에 계산한다. 정렬 전에 두면 모든 게시물마다 돌아 D1 읽기 한도를 쓴다.
 */
export async function getSiteHomeData(db: D1Database): Promise<HomeData> {
  const [settingRows, settingImageRes, recent, projects, perBoard] = await db.batch([
    ...buildSettingsStatements(db),
    db.prepare(`
      SELECT ${LIST_POST_COLUMNS}, pr.name AS project_name, pr.name_ja AS project_name_ja,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
        u.nickname AS author_nickname,
        g.global_num
      FROM (SELECT ${LIST_POST_COLUMNS} FROM posts p ORDER BY p.created_at DESC, p.id DESC LIMIT 5) p
      ${POST_GLOBAL_NUM_JOIN}
      LEFT JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN users u ON p.author_id = u.id
      ORDER BY p.created_at DESC, p.id DESC`),
    db.prepare('SELECT * FROM projects ORDER BY order_num ASC, created_at DESC'),
    db.prepare(`
      SELECT ranked.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = ranked.id) AS comment_count FROM (
        SELECT ${LIST_POST_COLUMNS},
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
  for (const row of perBoard.results as ListPostRow[]) {
    const key = Number(row.project_id);
    if (!byProject.has(key)) byProject.set(key, []);
    byProject.get(key)!.push(enrichListPostRow(row));
  }

  return {
    settings: parseSettingsResults(settingRows, settingImageRes),
    recentPosts: (recent.results as ListPostRow[]).map((row) => enrichListPostRow(row)),
    projects: (projects.results as Project[]).map((project) => ({ ...project, posts: byProject.get(Number(project.id)) ?? [] }))
  };
}
