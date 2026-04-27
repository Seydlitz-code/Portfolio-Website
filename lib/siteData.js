const { getDb } = require('../config/database');

/**
 * 홈(메인)과 마이페이지에서 공통으로 쓰는 settings / 게시물 / 프로젝트 데이터
 */
function getSiteHomeData() {
  const db = getDb();

  const settingsRows = db.prepare('SELECT key, value FROM site_settings').all();
  const settings = {};
  settingsRows.forEach((row) => { settings[row.key] = row.value; });

  const recentPosts = db.prepare(`
    SELECT p.*, pr.name as project_name
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    ORDER BY p.created_at DESC
    LIMIT 5
  `).all();

  const projects = db.prepare(`
    SELECT * FROM projects ORDER BY order_num ASC, created_at DESC
  `).all();

  const projectsWithPosts = projects.map((project) => {
    const posts = db.prepare(`
      SELECT * FROM posts WHERE project_id = ? ORDER BY created_at DESC LIMIT 5
    `).all(project.id);
    return { ...project, posts };
  });

  return { settings, recentPosts, projects: projectsWithPosts };
}

module.exports = { getSiteHomeData };
