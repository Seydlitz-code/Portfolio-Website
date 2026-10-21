/** 댓글 알림 (기존 lib/commentNotifications.js 이식) */

/** 게시글 본문 HTML에서 첫 이미지 src (썸네일용). 없으면 null */
export function firstImageSrcFromPostBody(html: unknown): string | null {
  if (!html || typeof html !== 'string') return null;
  const m = html.match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
  return m && m[1] ? m[1].trim() : null;
}

export function excerptText(s: unknown, maxLen: number): string {
  if (s == null) return '';
  const t = String(s).replace(/\s+/g, ' ').trim();
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen).trimEnd() + '…';
}

/** 관리자가 쓴 게시물에 다른 사람이 댓글을 달면 알림을 만든다. */
export async function createCommentNotification(
  db: D1Database,
  postId: number,
  commentId: number,
  actorUserId: number
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT p.author_id AS aid, u.is_admin AS ia
         FROM posts p LEFT JOIN users u ON u.id = p.author_id
        WHERE p.id = ?`
    )
    .bind(postId)
    .first<{ aid: number | null; ia: number | null }>();
  if (!row || row.aid == null) return;
  if (row.aid === actorUserId || row.ia !== 1) return;
  await db
    .prepare(
      `INSERT OR IGNORE INTO comment_notifications (recipient_user_id, comment_id, post_id, actor_user_id)
       VALUES (?, ?, ?, ?)`
    )
    .bind(row.aid, commentId, postId, actorUserId)
    .run();
}
