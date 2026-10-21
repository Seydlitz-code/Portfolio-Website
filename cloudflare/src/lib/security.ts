import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

/** 기존 lib/security.js와 같은 CSP */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
  "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  'frame-src https://www.youtube-nocookie.com https://www.youtube.com',
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'"
].join('; ');

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('Content-Security-Policy', CSP);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'SAMEORIGIN');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (new URL(c.req.url).protocol === 'https:') {
    h.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
};

function hostnameOf(value: string | undefined): string {
  if (!value) return '';
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * 상태를 바꾸는 요청(POST/PUT/DELETE 등)은 같은 사이트에서 온 것만 허용한다 (CSRF 방어).
 * Origin(없으면 Referer)의 호스트를 요청 호스트와 비교한다.
 * 두 헤더가 모두 없으면 SameSite=Lax 쿠키 정책에 맡긴다.
 */
export const sameOriginGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const m = c.req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
  const origin = c.req.header('origin');
  const source = origin && origin !== 'null' ? origin : c.req.header('referer');
  if (!source) {
    if (origin === 'null') return rejectCrossSite(c);
    return next();
  }
  if (hostnameOf(source) === new URL(c.req.url).hostname.toLowerCase()) return next();
  return rejectCrossSite(c);
};

function rejectCrossSite(c: Context<AppEnv>) {
  if ((c.req.header('accept') || '').includes('application/json')) {
    return c.json({ error: '허용되지 않은 요청 출처입니다.' }, 403);
  }
  return c.text('허용되지 않은 요청 출처입니다.', 403);
}

/**
 * 로그인 후 이동 경로: 같은 사이트 내부 경로만 허용한다.
 * 브라우저는 '\'를 '/'로 바꿔 해석하므로 '/\evil.com'도 '//evil.com'(외부)이 된다. 그래서 막는다.
 */
export function safeRedirectPath(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 2048) return null;
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  if (/[\\\u0000-\u001f\u007f]/.test(v)) return null;
  return v;
}

/** Cloudflare가 붙여 주는 실제 접속 IP */
export function clientIp(c: Context<AppEnv>): string {
  return c.req.header('cf-connecting-ip') || '0.0.0.0';
}
