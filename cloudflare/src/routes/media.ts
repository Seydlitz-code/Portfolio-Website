import { Hono } from 'hono';
import type { AppEnv } from '../types';

const DEFAULT_AVATAR = '/images/default-profile.svg';

const media = new Hono<AppEnv>();

/** 프로필 이미지. 파일은 R2에 있고, 없으면 기본 이미지로 보낸다. */
media.get('/user/:id/avatar', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) return c.notFound();

  const row = await c.env.DB.prepare('SELECT avatar_key FROM users WHERE id = ?')
    .bind(id)
    .first<{ avatar_key: string | null }>();
  if (!row?.avatar_key) return c.redirect(DEFAULT_AVATAR);

  const obj = await c.env.MEDIA.get(row.avatar_key);
  if (!obj) return c.redirect(DEFAULT_AVATAR);

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('ETag', obj.httpEtag);
  // 아바타를 바꾸면 R2 키가 바뀌므로 짧게 캐시해도 된다.
  headers.set('Cache-Control', 'public, max-age=300');
  return new Response(obj.body, { headers });
});

export default media;
