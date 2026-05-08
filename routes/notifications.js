const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { asyncRoute } = require('../lib/asyncRoute');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const {
  firstImageSrcFromPostBody,
  excerptText
} = require('../lib/commentNotifications');

router.get(
  '/notifications',
  requireLogin,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const recipientId = Number(req.session.user.id);
    const rows = await db.all(
      `
      SELECT cn.id, cn.comment_id AS comment_id, cn.post_id AS post_id, cn.read_at,
             cn.created_at AS n_created_at,
             p.title AS post_title, p.content AS post_content,
             c.content AS comment_content, c.created_at AS comment_created_at,
             actor.nickname AS actor_nickname, actor.avatar AS actor_avatar,
             actor.id AS actor_user_id
      FROM comment_notifications cn
      INNER JOIN posts p ON p.id = cn.post_id
      INNER JOIN comments c ON c.id = cn.comment_id
      INNER JOIN users actor ON actor.id = cn.actor_user_id
      WHERE cn.recipient_user_id = ?
      ORDER BY cn.created_at DESC
      LIMIT 40
    `,
      [recipientId]
    );

    const unreadRow = await db.get(
      `SELECT COUNT(*) AS c FROM comment_notifications WHERE recipient_user_id = ? AND read_at IS NULL`,
      [recipientId]
    );
    const unreadCount = unreadRow ? Number(unreadRow.c || 0) : 0;

    const items = rows.map(function (r) {
      const aid = Number(r.actor_user_id);
      const imgSrc = firstImageSrcFromPostBody(r.post_content);
      return {
        id: Number(r.id),
        postId: Number(r.post_id),
        commentId: Number(r.comment_id),
        postTitle: r.post_title != null ? String(r.post_title) : '',
        thumbUrl: imgSrc != null ? imgSrc : '/media/user/' + aid + '/avatar',
        excerpt: excerptText(r.comment_content, 96),
        actorNickname: r.actor_nickname != null ? String(r.actor_nickname) : '',
        actorAvatar:
          r.actor_avatar != null && String(r.actor_avatar).trim()
            ? String(r.actor_avatar).trim()
            : '/media/user/' + aid + '/avatar',
        createdAt: r.n_created_at != null ? r.n_created_at : r.comment_created_at,
        unread: r.read_at == null
      };
    });

    res.json({ unreadCount, items });
  })
);

router.post(
  '/notifications/read-all',
  requireLogin,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const recipientId = Number(req.session.user.id);
    await db.run(
      `UPDATE comment_notifications SET read_at = CURRENT_TIMESTAMP WHERE recipient_user_id = ? AND read_at IS NULL`,
      [recipientId]
    );
    res.json({ ok: true });
  })
);

router.post(
  '/notifications/:notificationId/read',
  requireLogin,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const recipientId = Number(req.session.user.id);
    const nid = Number(req.params.notificationId);
    if (!Number.isFinite(nid) || nid < 1) return res.status(400).json({ error: 'invalid id' });

    await db.run(
      `UPDATE comment_notifications SET read_at = CURRENT_TIMESTAMP WHERE id = ? AND recipient_user_id = ? AND read_at IS NULL`,
      [nid, recipientId]
    );
    res.json({ ok: true });
  })
);

module.exports = router;
