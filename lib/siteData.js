const db = require('./db');

/**
 * 홈(메인)과 마이페이지에서 공통으로 쓰는 settings / 게시물 / 프로젝트 데이터
 */
async function getSiteHomeData() {
  const settingsRows = await db.all('SELECT key, value FROM site_settings');
  const settings = {};
  settingsRows.forEach((row) => {
    settings[row.key] = row.value;
  });

  const recentPosts = await db.all(`
    SELECT p.*, pr.name as project_name
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    ORDER BY p.created_at DESC
    LIMIT 5
  `);

  const projects = await db.all(`SELECT * FROM projects ORDER BY order_num ASC, created_at DESC`);

  const projectsWithPosts = [];
  for (const project of projects) {
    const posts = await db.all(
      `SELECT * FROM posts WHERE project_id = ? ORDER BY created_at DESC LIMIT 5`,
      [project.id]
    );
    projectsWithPosts.push({ ...project, posts });
  }

  return { settings, recentPosts, projects: projectsWithPosts };
}

async function getSiteSettings() {
  const settingsRows = await db.all('SELECT key, value FROM site_settings');
  const settings = {};
  settingsRows.forEach((row) => {
    settings[row.key] = row.value;
  });
  return settings;
}

module.exports = { getSiteHomeData, getSiteSettings };
