const db = require('./db');
const { KIND_SITE_PROFILE_IMAGE } = require('./binaryAssets');
const {
  formatListTime,
  truncatePostTitleLine,
  truncateBoardNameLine
} = require('./listingHelpers');

const POST_GLOBAL_NUM_SQL = `(
  (SELECT COUNT(*) FROM posts) -
  (
    SELECT COUNT(*) FROM posts p2
    WHERE (p2.created_at > p.created_at)
       OR (p2.created_at = p.created_at AND p2.id > p.id)
  )
)`;

function enrichHomePostRow(p) {
  return {
    ...p,
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
      ${POST_GLOBAL_NUM_SQL} AS global_num
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    LEFT JOIN users u ON p.author_id = u.id
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT 5
  `
  );
  const recentPosts = recentRows.map(enrichHomePostRow);

  const projects = await db.all(`SELECT * FROM projects ORDER BY order_num ASC, created_at DESC`);

  const projectsWithPosts = [];
  for (const project of projects) {
    const postRows = await db.all(
      `
      SELECT p.*,
        (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
        u.nickname AS author_nickname,
        ${POST_GLOBAL_NUM_SQL} AS global_num
      FROM posts p
      LEFT JOIN users u ON p.author_id = u.id
      WHERE p.project_id = ?
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 5
    `,
      [project.id]
    );
    projectsWithPosts.push({ ...project, posts: postRows.map(enrichHomePostRow) });
  }

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

module.exports = { getSiteHomeData, getSiteSettings };
