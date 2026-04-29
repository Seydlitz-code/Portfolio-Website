const { getDb } = require('../config/database');
const { isUserAdmin } = require('../middleware/auth');

/**
 * 마이페이지 공통 상단·사이드용 사용자 정보
 */
function getAccountShell(req) {
  const db = getDb();
  const row = db.prepare('SELECT id, username, nickname, avatar FROM users WHERE id = ?').get(req.session.user.id);
  if (!row) return null;
  const avatar = row.avatar != null && String(row.avatar).trim() !== '' ? String(row.avatar).trim() : null;
  return {
    headerNickname: String(row.nickname || '').trim(),
    profileUser: {
      id: row.id,
      nickname: String(row.nickname || '').trim(),
      username: row.username,
      avatar
    },
    initialNickname: String(row.nickname || '').trim(),
    initialAvatar: avatar,
    isAdmin: isUserAdmin(req.session.user),
    mypageAccountActive: true
  };
}

module.exports = { getAccountShell };
