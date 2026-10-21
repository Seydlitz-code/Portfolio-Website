/** 관리자 댓글 알림 API (기존 routes/notifications.js 이식). nav-notifications.js가 호출한다. */
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { requireAdmin, requireLogin } from '../lib/http';
import { parseId } from '../lib/ids';
import { excerptText, firstImageSrcFromPostBody } from '../lib/commentNotifications';
import { NOW_SQL, toIsoUtc } from '../lib/time';

const api = new Hono<AppEnv>();

api.use('/notifications', requireLogin, requireAdmin);
api.use('/notifications/*', requireLogin, requireAdmin);

api.get('/notifications', async (c) => {
  const db = c.env.DB;
  const recipientId = c.get('user')!.id;
  const [rows, unread] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT cn.id, cn.comment_id, cn.post_id, cn.read_at, cn.created_at AS n_created_at,
                p.title AS post_title, p.content AS post_content,
                c.content AS comment_content, c.created_at AS comment_created_at,
                actor.nickname AS actor_nickname, actor.id AS actor_user_id
           FROM comment_notifications cn
           JOIN posts p ON p.id = cn.post_id
           JOIN comments c ON c.id = cn.comment_id
           JOIN users actor ON actor.id = cn.actor_user_id
          WHERE cn.recipient_user_id = ?
          ORDER BY cn.created_at DESC
          LIMIT 40`
      )
      .bind(recipientId),
    db
      .prepare('SELECT COUNT(*) AS n FROM comment_notifications WHERE recipient_user_id = ? AND read_at IS NULL')
      .bind(recipientId)
  ]);

  const items = rows.results.map((r) => {
    const aid = Number(r.actor_user_id);
    const avatar = `/media/user/${aid}/avatar`;
    return {
      id: Number(r.id),
      postId: Number(r.post_id),
      commentId: Number(r.comment_id),
      postTitle: r.post_title != null ? String(r.post_title) : '',
      thumbUrl: firstImageSrcFromPostBody(r.post_content) ?? avatar,
      excerpt: excerptText(r.comment_content, 96),
      actorNickname: r.actor_nickname != null ? String(r.actor_nickname) : '',
      actorAvatar: avatar,
      createdAt: toIsoUtc(r.n_created_at ?? r.comment_created_at),
      unread: r.read_at == null
    };
  });
  return c.json({ unreadCount: Number(unread.results[0]?.n ?? 0), items });
});

api.post('/notifications/read-all', async (c) => {
  await c.env.DB.prepare(
    `UPDATE comment_notifications SET read_at = ${NOW_SQL} WHERE recipient_user_id = ? AND read_at IS NULL`
  )
    .bind(c.get('user')!.id)
    .run();
  return c.json({ ok: true });
});

api.post('/notifications/:notificationId/read', async (c) => {
  const nid = parseId(c.req.param('notificationId'));
  if (nid == null) return c.json({ error: 'invalid id' }, 400);
  await c.env.DB.prepare(
    `UPDATE comment_notifications SET read_at = ${NOW_SQL} WHERE id = ? AND recipient_user_id = ? AND read_at IS NULL`
  )
    .bind(nid, c.get('user')!.id)
    .run();
  return c.json({ ok: true });
});

export default api;
