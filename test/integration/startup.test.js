/**
 * 배포 환경 기동 조건: SESSION_SECRET 필수, 운영 쿠키 플래그.
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { freshDbEnv, startServer, runServerExpectExit, ADMIN } = require('../helpers');

const ADMIN_ENV = { ADMIN_BOOTSTRAP_USERNAME: ADMIN.username, ADMIN_BOOTSTRAP_PASSWORD: ADMIN.password };

describe('SESSION_SECRET 없으면 배포 환경에서 기동 중단', () => {
  for (const [label, env] of [
    ['NODE_ENV=production', { NODE_ENV: 'production' }],
    ['Railway (RAILWAY_ENVIRONMENT_NAME)', { RAILWAY_ENVIRONMENT_NAME: 'production' }],
    ['Render (RENDER=true)', { RENDER: 'true' }]
  ]) {
    it(label, async () => {
      const { code, out } = await runServerExpectExit({ dbEnv: await freshDbEnv(), env: { ...ADMIN_ENV, ...env } });
      assert.equal(code, 1);
      assert.match(out, /SESSION_SECRET/);
    });
  }
});

describe('운영 모드 쿠키', () => {
  it('HTTPS 프록시 경유 로그인: HttpOnly·Secure·SameSite=Lax + HSTS', async () => {
    const server = await startServer({ dbEnv: await freshDbEnv(), env: { RAILWAY_ENVIRONMENT_NAME: 'production' } });
    try {
      const res = await fetch(`${server.base}/auth/login`, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Forwarded-Proto': 'https',
          Origin: 'https://127.0.0.1'
        },
        body: new URLSearchParams(ADMIN).toString()
      });
      assert.equal(res.status, 302);
      const cookie = res.headers.getSetCookie().find((c) => c.startsWith('portfolio.sid='));
      assert.ok(cookie, '세션 쿠키 발급');
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /Secure/);
      assert.match(cookie, /SameSite=Lax/);
      assert.match(res.headers.get('strict-transport-security') || '', /max-age=/);
    } finally {
      await server.stop();
    }
  });
});
