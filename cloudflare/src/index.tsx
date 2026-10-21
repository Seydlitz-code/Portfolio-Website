import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) =>
  c.html(
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Portfolio</title>
      </head>
      <body>
        <h1>Portfolio on Cloudflare Workers</h1>
        <p>뼈대가 동작합니다.</p>
      </body>
    </html>
  )
);

app.get('/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
  // 없는 키를 head로 조회: 버킷에 닿으면 null이 오고, 연결이 안 되면 예외가 난다.
  let media = false;
  try {
    await c.env.MEDIA.head('__health__');
    media = true;
  } catch {
    media = false;
  }
  return c.json({ ok: true, db: row?.ok === 1, media });
});

export default app;
