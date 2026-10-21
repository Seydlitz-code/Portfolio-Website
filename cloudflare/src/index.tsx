import { Hono, type MiddlewareHandler } from 'hono';
import type { AppEnv, Env } from './types';
import { HomePage } from './views/home';
import { ErrorPage } from './views/layout';
import { loadSessionUser } from './lib/session';
import { sameOriginGuard, securityHeaders } from './lib/security';
import { RATE_LIMIT_RETENTION_MS } from './lib/rateLimit';
import { navData } from './lib/http';
import { getSiteHomeData } from './lib/siteData';
import { sanitizeBioHtml, sanitizePostHtml } from './lib/html';
import { sweepOrphanAssets } from './lib/postAssets';
import authRoutes from './routes/auth';
import mediaRoutes from './routes/media';
import postsRoutes from './routes/posts';
import boardsRoutes from './routes/boards';
import adminRoutes from './routes/admin';
import mypageRoutes from './routes/mypage';
import notificationsRoutes from './routes/notifications';

// strict: false → '/mypage/'처럼 끝에 /가 붙어도 같은 화면 (기존 Express와 같음)
const app = new Hono<AppEnv>({ strict: false });

/**
 * HTML 폼은 GET/POST만 보낼 수 있으므로 PUT/DELETE는 POST + _method로 보낸다.
 * 기존 서버는 쿼리(?_method=PUT)만 읽어서, 숨김 필드로 보내는 게시판 수정·삭제 폼이 404가 났다.
 * 여기서는 쿼리와 폼 본문(application/x-www-form-urlencoded) 둘 다 읽는다.
 */
const OVERRIDABLE = new Set(['PUT', 'PATCH', 'DELETE']);
const methodOverride: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'POST') return next();
  let method = (c.req.query('_method') || '').toUpperCase();
  let body: BodyInit | null = null;
  const type = c.req.header('content-type') || '';
  if (type.startsWith('application/x-www-form-urlencoded')) {
    const text = await c.req.raw.clone().text();
    if (!method) method = (new URLSearchParams(text).get('_method') || '').toUpperCase();
    body = text;
  } else if (method) {
    body = await c.req.raw.clone().arrayBuffer();
  }
  if (!OVERRIDABLE.has(method)) return next();
  const req = new Request(c.req.url, { method, headers: c.req.raw.headers, body });
  return app.fetch(req, c.env, c.executionCtx);
};

app.use(methodOverride);
app.use(securityHeaders);

/* 배포 헬스체크: 세션·사용자 조회 없이 DB 연결만 확인 */
app.get('/healthz', async (c) => {
  c.header('Cache-Control', 'no-store');
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ ok: true });
  } catch (err) {
    console.error('[healthz] DB 확인 실패', err);
    return c.json({ ok: false }, 503);
  }
});

app.get('/health', async (c) => {
  c.header('Cache-Control', 'no-store');
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

app.route('/media', mediaRoutes);

app.use(sameOriginGuard);
app.use(async (c, next) => {
  const user = await loadSessionUser(c);
  c.set('user', user);
  let unread = 0;
  if (user?.isAdmin) {
    const row = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM comment_notifications WHERE recipient_user_id = ? AND read_at IS NULL'
    )
      .bind(user.id)
      .first<{ n: number }>();
    unread = Number(row?.n ?? 0);
  }
  c.set('unreadCount', unread);
  await next();
});

app.route('/auth', authRoutes);
app.route('/boards', boardsRoutes);
app.route('/posts', postsRoutes);
app.route('/admin', adminRoutes);
app.route('/mypage', mypageRoutes);
app.route('/api', notificationsRoutes);

app.get('/', async (c) => {
  const home = await getSiteHomeData(c.env.DB);
  const nameHtml = await sanitizePostHtml(home.settings.site_name ?? '');
  const bio = home.settings.bio ?? '';
  return c.html(
    <HomePage
      nav={await navData(c, home.settings)}
      siteNameHtml={nameHtml}
      bioHtml={bio.replace(/\s/g, '').length ? await sanitizeBioHtml(bio) : ''}
      profileImage={home.settings.profile_image ?? ''}
      recentPosts={home.recentPosts}
      projects={home.projects}
    />
  );
});

app.notFound((c) => c.html(<ErrorPage code={404} message="페이지를 찾을 수 없습니다." />, 404));

app.onError((err, c) => {
  console.error('[error]', c.req.method, new URL(c.req.url).pathname, err);
  return c.html(<ErrorPage code={500} message="서버 오류가 발생했습니다." />, 500);
});

/** Cron(6시간마다): 만료 세션·오래된 시도 제한 기록·미참조 첨부를 지운다. */
export async function cleanup(env: Env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(new Date().toISOString()),
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(Date.now() - RATE_LIMIT_RETENTION_MS)
  ]);
  await sweepOrphanAssets(env);
}

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanup(env));
  }
} satisfies ExportedHandler<Env>;
