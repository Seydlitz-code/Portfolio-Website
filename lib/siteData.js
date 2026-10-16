const db = require('./db');
const { KIND_SITE_PROFILE_IMAGE } = require('./binaryAssets');
const {
  toIsoUtc,
  formatListTime,
  truncatePostTitleLine,
  truncateBoardNameLine
} = require('./listingHelpers');

/**
 * 전체 게시물 기준 글 번호(오래된 글 = 1). 별칭 g.global_num 으로 사용.
 * 행마다 COUNT 하위 쿼리를 돌리던 방식(O(n²)) 대신 윈도 함수 한 번으로 계산.
 */
const POST_GLOBAL_NUM_JOIN = `JOIN (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS global_num FROM posts
) g ON g.id = p.id`;

/** 목록 행 공통 표시 필드 */
function enrichListPostRow(p) {
  return {
    ...p,
    created_at_iso: toIsoUtc(p.created_at),
    display_time: formatListTime(p.created_at),
    view_count: p.view_count != null ? Number(p.view_count) : 0,
    comment_count: p.comment_count != null ? Number(p.comment_count) : 0,
    global_num: p.global_num != null ? Number(p.global_num) : 0,
    title_ko_short: truncatePostTitleLine(p.title),
    title_ja_short: truncatePostTitleLine(p.title_ja != null ? p.title_ja : '')
  };
}

function enrichHomePostRow(p) {
  return {
    ...p,
    created_at_iso: toIsoUtc(p.created_at),
    display_time: formatListTime(p.created_at),
    view_count: p.view_count != null ? Number(p.view_count) : 0,
    comment_count: p.comment_count != null ? Number(p.comment_count) : 0,
    global_num: p.global_num != null ? Number(p.global_num) : 0,
    title_ko_short: truncatePostTitleLine(p.title),
    title_ja_short: truncatePostTitleLine(p.title_ja != null ? p.title_ja : ''),
    project_name_ko_short: truncateBoardNameLine(p.project_name || ''),
    project_name_ja_short: truncateBoardNameLine(
      p.project_name_ja != null ? String(p.project_name_ja) : ''
    )
  };
}

async function hydrateSiteProfileImage(settings) {
  if (!settings) return;
  const row = await db.get('SELECT kind FROM persisted_binaries WHERE kind = ?', [
    KIND_SITE_PROFILE_IMAGE
  ]);
  if (row) settings.profile_image = '/media/site/profile-image';
}

/**
 * 홈(메인)과 마이페이지에서 공통으로 쓰는 settings / 게시물 / 프로젝트 데이터
 */
async function getSiteHomeData() {
  const settingsRows = await db.all('SELECT key, value FROM site_settings');
  const settings = {};
  settingsRows.forEach((row) => {
    settings[row.key] = row.value;
  });
  await hydrateSiteProfileImage(settings);

  const recentRows = await db.all(
    `
    SELECT p.*, pr.name AS project_name, pr.name_ja AS project_name_ja,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
      u.nickname AS author_nickname,
      g.global_num
    FROM posts p
    ${POST_GLOBAL_NUM_JOIN}
    LEFT JOIN projects pr ON p.project_id = pr.id
    LEFT JOIN users u ON p.author_id = u.id
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT 5
  `
  );
  const recentPosts = recentRows.map(enrichHomePostRow);

  const projects = await db.all(`SELECT * FROM projects ORDER BY order_num ASC, created_at DESC`);

  /* 게시판별 최신 5개를 한 번의 쿼리로 (게시판 수만큼 반복 조회하지 않음) */
  const perBoardRows = await db.all(
    `
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
    ORDER BY created_at DESC, id DESC
  `
  );
  const postsByProject = new Map();
  perBoardRows.forEach((row) => {
    const key = Number(row.project_id);
    if (!postsByProject.has(key)) postsByProject.set(key, []);
    postsByProject.get(key).push(enrichHomePostRow(row));
  });

  const projectsWithPosts = projects.map((project) => ({
    ...project,
    posts: postsByProject.get(Number(project.id)) || []
  }));

  return { settings, recentPosts, projects: projectsWithPosts };
}

async function getSiteSettings() {
  const settingsRows = await db.all('SELECT key, value FROM site_settings');
  const settings = {};
  settingsRows.forEach((row) => {
    settings[row.key] = row.value;
  });
  await hydrateSiteProfileImage(settings);
  return settings;
}

module.exports = { getSiteHomeData, getSiteSettings, POST_GLOBAL_NUM_JOIN, enrichListPostRow };
