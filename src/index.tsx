/** 앱 조립: 미들웨어 순서, 라우트 연결, 오류 화면, Cron 정리 작업 */
import { Hono, type MiddlewareHandler } from 'hono';
import type { AppEnv, Env } from './types';
import { HomePage } from './views/home';
import { ErrorPage } from './views/layout';
import { loadSessionUser } from './lib/session';
import { requireSameOrigin, addSecurityHeaders } from './lib/security';
import { RATE_LIMIT_RETENTION_MS } from './lib/rateLimit';
import { buildNavData, limitRequestBody } from './lib/http';
import { getSiteHomeData } from './lib/siteData';
import { sanitizeBioHtml, sanitizePostHtml } from './lib/html';
import { sweepOrphanAssets } from './lib/postAssets';
import authRoutes from './routes/auth';
import mediaRoutes from './routes/media';
import postsRoutes from './routes/posts';
import boardsRoutes from './routes/boards';
import adminRoutes from './routes/admin';
import mypageRoutes from './routes/mypage';
import apiRoutes from './routes/api';

// strict: false → '/mypage/'처럼 끝에 /가 붙어도 같은 화면 (기존 Express와 같음)
const app = new Hono<AppEnv>({ strict: false });

/**
 * HTML 폼은 GET/POST만 보낼 수 있으므로 PUT/DELETE는 POST + _method로 보낸다.
 * 기존 서버는 쿼리(?_method=PUT)만 읽어서, 숨김 필드로 보내는 게시판 수정·삭제 폼이 404가 났다.
 * 여기서는 쿼리와 폼 본문(application/x-www-form-urlencoded) 둘 다 읽는다.
 * 본문 크기는 앞의 limitRequestBody가 이미 막았다. c.req.text()는 Hono가 캐시하므로 라우트의 폼 읽기가
 * 이 결과를 다시 쓴다 (본문을 복제하거나 두 번 받지 않음). _method가 없는 대부분의 요청은 파싱하지 않는다.
 */
const OVERRIDABLE_METHODS = new Set(['PUT', 'PATCH', 'DELETE']);

const applyMethodOverride: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== 'POST') return next();
  const queryMethod = (c.req.query('_method') || '').toUpperCase();
  const mediaType = (c.req.header('content-type') || '').split(';')[0].trim().toLowerCase();

  if (mediaType !== 'application/x-www-form-urlencoded') {
    if (!OVERRIDABLE_METHODS.has(queryMethod)) return next();
    // 본문을 읽지 않고 스트림 그대로 넘긴다 (파일 업로드도 버퍼링하지 않음).
    return app.fetch(new Request(c.req.raw, { method: queryMethod }), c.env, c.executionCtx);
  }

  const text = await c.req.text();
  const bodyMethod = text.includes('_method=') ? new URLSearchParams(text).get('_method') || '' : '';
  const method = queryMethod || bodyMethod.toUpperCase();
  if (!OVERRIDABLE_METHODS.has(method)) return next();
  // 바뀐 메서드로 앱 전체를 다시 태운다 (이 미들웨어가 맨 앞이라 다른 미들웨어는 한 번만 돈다).
  const overridden = new Request(c.req.url, { method, headers: c.req.raw.headers, body: text });
  return app.fetch(overridden, c.env, c.executionCtx);
};

app.use(limitRequestBody);
app.use(applyMethodOverride);
app.use(addSecurityHeaders);

/** 배포 헬스체크: 세션·사용자 조회 없이 DB 연결만 확인 */
app.get('/healthz', async (c) => {
  c.header('Cache-Control', 'no-store');
  try {
    await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return c.json({ ok: true });
  } catch (err) {
    console.error('[healthz] DB 확인 실패', err);
    return c.json({ ok: false }, 503);
  }
});

/** 운영 확인용: D1·R2 연결 상태 */
app.get('/health', async (c) => {
  c.header('Cache-Control', 'no-store');
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
  // 없는 키를 head로 조회: 버킷에 닿으면 null이 오고, 연결이 안 되면 예외가 난다.
  let isMediaReachable = false;
  try {
    await c.env.MEDIA.head('__health__');
    isMediaReachable = true;
  } catch {
    isMediaReachable = false;
  }
  return c.json({ ok: true, db: row?.ok === 1, media: isMediaReachable });
});

// 이미지·동영상은 GET만 받고 로그인 정보가 필요 없어 세션 조회 앞에 둔다.
app.route('/media', mediaRoutes);

app.use(requireSameOrigin);
// 로그인 사용자와 (관리자라면) 안 읽은 알림 수를 쿼리 한 번으로 불러 둔다.
app.use(async (c, next) => {
  const { user, unreadCount } = await loadSessionUser(c);
  c.set('user', user);
  c.set('unreadCount', unreadCount);
  await next();
});

app.route('/auth', authRoutes);
app.route('/boards', boardsRoutes);
app.route('/posts', postsRoutes);
app.route('/admin', adminRoutes);
app.route('/mypage', mypageRoutes);
app.route('/api', apiRoutes);

app.get('/', async (c) => {
  const home = await getSiteHomeData(c.env.DB);
  const nameHtml = await sanitizePostHtml(home.settings.site_name ?? '');
  const bio = home.settings.bio ?? '';
  return c.html(
    <HomePage
      nav={await buildNavData(c, home.settings)}
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
async function cleanupExpiredData(env: Env) {
  // 만료 기록 삭제와 첨부 정리에 필요한 조회를 D1 왕복 한 번으로 보낸다.
  await sweepOrphanAssets(env, Date.now(), [
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(new Date().toISOString()),
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(Date.now() - RATE_LIMIT_RETENTION_MS)
  ]);
}

export default {
  fetch: app.fetch,
  scheduled(_controller, env, executionContext) {
    executionContext.waitUntil(cleanupExpiredData(env));
  }
} satisfies ExportedHandler<Env>;
