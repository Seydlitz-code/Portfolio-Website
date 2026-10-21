import { Hono } from 'hono';

type Bindings = {
  DB: D1Database;
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
  return c.json({ ok: true, db: row?.ok === 1 });
});

export default app;
