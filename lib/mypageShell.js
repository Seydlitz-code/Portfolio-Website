const db = require('./db');
const { isUserAdmin } = require('../middleware/auth');

/**
 * 마이페이지 공통 상단·사이드용 사용자 정보
 */
async function getAccountShell(req) {
  const row = await db.get('SELECT id, username, nickname, avatar FROM users WHERE id = ?', [
    req.session.user.id
  ]);
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
