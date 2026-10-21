import { Hono } from 'hono';
import type { AppEnv, Env } from './types';
import { Layout } from './views/layout';
import { loadSessionUser } from './lib/session';
import { sameOriginGuard, securityHeaders } from './lib/security';
import { RATE_LIMIT_RETENTION_MS } from './lib/rateLimit';
import authRoutes from './routes/auth';
import mediaRoutes from './routes/media';

const app = new Hono<AppEnv>();

app.use(securityHeaders);
app.use(sameOriginGuard);
app.use(async (c, next) => {
  c.set('user', await loadSessionUser(c));
  await next();
});

app.route('/auth', authRoutes);
app.route('/media', mediaRoutes);

// 임시 메인 화면: 로그인 상태만 보여 준다. 기존 메인 화면은 게시판을 옮길 때 이식한다.
app.get('/', (c) => {
  const user = c.get('user');
  return c.html(
    <Layout title="Portfolio" bodyClass="auth-page">
      <div class="auth-container">
        <div class="auth-card">
          <h1 class="auth-title">Portfolio on Cloudflare Workers</h1>
          {user ? (
            <>
              <p class="auth-sub">
                <img src={user.avatarUrl ?? '/images/default-profile.svg'} alt="" width={32} height={32} />{' '}
                {user.nickname}님 ({user.username}){user.isAdmin && ' · 관리자'}
              </p>
              <form action="/auth/logout" method="post">
                <button type="submit" class="btn-primary btn-full">
                  로그아웃
                </button>
              </form>
            </>
          ) : (
            <p class="auth-switch">
              <a href="/auth/login">로그인</a> · <a href="/auth/register">회원가입</a>
            </p>
          )}
        </div>
      </div>
    </Layout>
  );
});

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

app.onError((err, c) => {
  console.error('[error]', c.req.method, new URL(c.req.url).pathname, err);
  return c.text('서버 오류가 발생했습니다.', 500);
});

/** 매일 Cron: 만료된 세션과 오래된 시도 제한 기록을 지운다. */
async function cleanup(env: Env) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(new Date().toISOString()),
    env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(Date.now() - RATE_LIMIT_RETENTION_MS)
  ]);
}

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanup(env));
  }
} satisfies ExportedHandler<Env>;
