const { usePostgres } = require('../config/database');

function isTruthyAdmin(flag) {
  return Number(flag) === 1 || flag === true;
}

/** 게시글 본문 HTML에서 첫 이미지 src (썸네일용). 없으면 null */
function firstImageSrcFromPostBody(html) {
  if (!html || typeof html !== 'string') return null;
  const m = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
  return m && m[1] ? String(m[1]).trim() : null;
}

function excerptText(s, maxLen) {
  if (s == null) return '';
  let t = String(s).replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen).trimEnd() + '…';
}

/**
 * 관리자가 작성자인 게시물에 다른 사용자가 댓글을 달았을 때 알림 행 추가
 */
async function createCommentNotification(db, postId, commentId, actorUserId) {
  const row = await db.get(
    `SELECT p.author_id AS aid, u.is_admin AS ia
     FROM posts p
     LEFT JOIN users u ON u.id = p.author_id
     WHERE p.id = ?`,
    [postId]
  );
  if (!row || row.aid == null) return;

  const authorId = Number(row.aid);
  if (!Number.isFinite(authorId) || authorId === Number(actorUserId)) return;
  if (!isTruthyAdmin(row.ia)) return;

  if (usePostgres()) {
    await db.run(
      `INSERT INTO comment_notifications (recipient_user_id, comment_id, post_id, actor_user_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (comment_id) DO NOTHING`,
      [authorId, commentId, postId, actorUserId]
    );
  } else {
    await db.run(
      `INSERT OR IGNORE INTO comment_notifications (recipient_user_id, comment_id, post_id, actor_user_id)
       VALUES (?, ?, ?, ?)`,
      [authorId, commentId, postId, actorUserId]
    );
  }
}

module.exports = {
  createCommentNotification,
  firstImageSrcFromPostBody,
  excerptText
};
