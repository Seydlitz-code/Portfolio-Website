/** /api: 관리자 댓글 알림 API (기존 routes/notifications.js 이식). nav-notifications.js가 호출한다. */
import { Hono } from 'hono';
import type { AppEnv } from '../types';
import { requireAdmin, requireLogin } from '../lib/http';
import { parseId } from '../lib/ids';
import { buildExcerpt, findFirstImageSrc } from '../lib/commentNotifications';
import { NOW_SQL, toIsoUtc } from '../lib/time';

/** 알림 패널에 보여 줄 최근 알림 수 (기존 서버와 같음) */
const NOTIFICATION_LIST_LIMIT = 40;
/** 알림 패널의 댓글 미리보기 최대 글자 수 */
const EXCERPT_MAX_LENGTH = 96;
/**
 * 썸네일을 찾을 때 본문에서 잘라 오는 길이: 첫 <img부터 2048자.
 * 본문 전체(수 MB 가능)를 알림 수만큼 읽어 오지 않기 위함이다. src가 이보다 길면(data: 이미지 등) 아바타로 대신한다.
 */
const IMAGE_TAG_SNIPPET_CHARS = 2048;

const api = new Hono<AppEnv>();

api.use('/notifications', requireLogin, requireAdmin);
api.use('/notifications/*', requireLogin, requireAdmin);

/**
 * 알림 목록. 보여 줄 알림 40개를 먼저 고른 뒤 게시물·댓글·작성자를 붙이고 본문 조각을 읽는다.
 * 정렬 전에 붙이면 쌓인 알림 전부마다 게시물 본문을 읽어 D1 읽기 한도를 쓴다.
 */
api.get('/notifications', async (c) => {
  const db = c.env.DB;
  const recipientId = c.get('user')!.id;
  const [rows, unread] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT cn.id, cn.comment_id, cn.post_id, cn.read_at, cn.created_at AS notification_created_at,
                p.title AS post_title,
                CASE WHEN instr(p.content, '<img') > 0
                     THEN substr(p.content, instr(p.content, '<img'), ?3) END AS post_image_tag,
                c.content AS comment_content, c.created_at AS comment_created_at,
                actor.nickname AS actor_nickname, actor.id AS actor_user_id
           FROM (SELECT * FROM comment_notifications WHERE recipient_user_id = ?1
                  ORDER BY created_at DESC, id DESC LIMIT ?2) cn
           JOIN posts p ON p.id = cn.post_id
           JOIN comments c ON c.id = cn.comment_id
           JOIN users actor ON actor.id = cn.actor_user_id
          ORDER BY cn.created_at DESC, cn.id DESC`
      )
      .bind(recipientId, NOTIFICATION_LIST_LIMIT, IMAGE_TAG_SNIPPET_CHARS),
    db
      .prepare('SELECT COUNT(*) AS count FROM comment_notifications WHERE recipient_user_id = ? AND read_at IS NULL')
      .bind(recipientId)
  ]);

  const items = rows.results.map((row) => {
    const actorId = Number(row.actor_user_id);
    const actorAvatarUrl = `/media/user/${actorId}/avatar`;
    return {
      id: Number(row.id),
      postId: Number(row.post_id),
      commentId: Number(row.comment_id),
      postTitle: row.post_title != null ? String(row.post_title) : '',
      thumbUrl: findFirstImageSrc(row.post_image_tag) ?? actorAvatarUrl,
      excerpt: buildExcerpt(row.comment_content, EXCERPT_MAX_LENGTH),
      actorNickname: row.actor_nickname != null ? String(row.actor_nickname) : '',
      actorAvatar: actorAvatarUrl,
      createdAt: toIsoUtc(row.notification_created_at ?? row.comment_created_at),
      unread: row.read_at == null
    };
  });
  return c.json({ unreadCount: Number(unread.results[0]?.count ?? 0), items });
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
  const notificationId = parseId(c.req.param('notificationId'));
  if (notificationId == null) return c.json({ error: 'invalid id' }, 400);
  await c.env.DB.prepare(
    `UPDATE comment_notifications SET read_at = ${NOW_SQL} WHERE id = ? AND recipient_user_id = ? AND read_at IS NULL`
  )
    .bind(notificationId, c.get('user')!.id)
    .run();
  return c.json({ ok: true });
});

export default api;
