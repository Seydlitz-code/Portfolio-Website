/** 댓글 알림: 관리자가 쓴 게시물에 다른 사람이 댓글을 달면 알림을 남긴다 (기존 lib/commentNotifications.js 이식) */

/** HTML(게시글 본문이나 그 일부)에서 첫 이미지 src (썸네일용). 없으면 null */
export function findFirstImageSrc(html: unknown): string | null {
  if (!html || typeof html !== 'string') return null;
  const match = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
  return match && match[1] ? match[1].trim() : null;
}

/** 공백을 정리하고 maxLength 글자를 넘으면 말줄임표를 붙인다 */
export function buildExcerpt(value: unknown, maxLength: number): string {
  if (value == null) return '';
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '…';
}

export type PostAuthorRow = { id: number; author_id: number | null; author_is_admin: number | null };

/** 게시물이 있는지와 작성자가 관리자인지를 함께 읽는 쿼리 (댓글 작성 전 확인용) */
export function buildPostAuthorStatement(db: D1Database, postId: number): D1PreparedStatement {
  return db
    .prepare(
      `SELECT p.id, p.author_id, u.is_admin AS author_is_admin
         FROM posts p LEFT JOIN users u ON u.id = p.author_id
        WHERE p.id = ?`
    )
    .bind(postId);
}

/** 알림 대상: 작성자가 관리자이고, 댓글을 단 사람이 작성자 본인이 아닐 때 */
export function shouldNotifyAuthor(post: PostAuthorRow, actorUserId: number): post is PostAuthorRow & { author_id: number } {
  return post.author_id != null && post.author_id !== actorUserId && post.author_is_admin === 1;
}

/**
 * 방금 넣은 댓글에 대한 알림을 넣는 쿼리. 댓글 INSERT 바로 뒤에 같은 db.batch로 보낸다.
 * batch는 한 트랜잭션에서 순서대로 실행되므로, 이 사용자의 가장 최근 댓글이 방금 넣은 댓글이다.
 */
export function buildNotificationForNewComment(
  db: D1Database,
  recipientUserId: number,
  postId: number,
  actorUserId: number
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT OR IGNORE INTO comment_notifications (recipient_user_id, comment_id, post_id, actor_user_id)
       VALUES (?1,
               (SELECT id FROM comments WHERE post_id = ?2 AND user_id = ?3 ORDER BY id DESC LIMIT 1),
               ?2, ?3)`
    )
    .bind(recipientUserId, postId, actorUserId);
}
