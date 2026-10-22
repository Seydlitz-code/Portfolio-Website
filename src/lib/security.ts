/** 보안 헤더(검색 제외 표시 포함), CSRF 출처 검사, 안전한 이동 경로, 접속 IP (기존 lib/security.js 이식) */
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

/** 기존 서버와 같은 CSP. 외부 리소스는 Google Fonts·cdnjs(Font Awesome)·YouTube 임베드만 허용한다. */
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

/** HTTPS에서 HSTS 유지 기간: 180일 */
const HSTS_MAX_AGE_SEC = 180 * 24 * 60 * 60;

/**
 * 검색 결과에 넣지 말라는 표시. 사이트는 링크를 아는 사람만 들어오게 한다 (2026-10-22 결정).
 * robots.txt의 수집 차단만으로는 다른 곳에 링크가 걸리면 주소만 검색 결과에 오를 수 있어 함께 붙인다.
 * 정적 파일은 public/_headers에서 같은 값을 붙인다.
 */
export const ROBOTS_TAG = 'noindex, nofollow, noarchive';

export const addSecurityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const headers = c.res.headers;
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('X-Robots-Tag', ROBOTS_TAG);
  if (new URL(c.req.url).protocol === 'https:') {
    headers.set('Strict-Transport-Security', `max-age=${HSTS_MAX_AGE_SEC}; includeSubDomains`);
  }
};

function getHostname(value: string | undefined): string {
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
export const requireSameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const origin = c.req.header('origin');
  const source = origin && origin !== 'null' ? origin : c.req.header('referer');
  if (!source) {
    if (origin === 'null') return rejectCrossSite(c);
    return next();
  }
  if (getHostname(source) === new URL(c.req.url).hostname.toLowerCase()) return next();
  return rejectCrossSite(c);
};

function rejectCrossSite(c: Context<AppEnv>) {
  if ((c.req.header('accept') || '').includes('application/json')) {
    return c.json({ error: '허용되지 않은 요청 출처입니다.' }, 403);
  }
  return c.text('허용되지 않은 요청 출처입니다.', 403);
}

/** 백슬래시와 제어 문자(0x00~0x1f, 0x7f). 소스에 이스케이프를 쓰지 않으려고 문자 코드로 만든다. */
const UNSAFE_PATH_CHARS = new RegExp(
  '[\\\\' + String.fromCharCode(0) + '-' + String.fromCharCode(0x1f) + String.fromCharCode(0x7f) + ']'
);
/** 이동 경로(next) 최대 길이: 2048글자 (브라우저가 무리 없이 다루는 URL 길이의 관례 상한) */
const REDIRECT_PATH_MAX = 2048;

/**
 * 로그인 후 이동 경로: 같은 사이트 내부 경로만 허용한다.
 * 브라우저는 '\'를 '/'로 바꿔 해석하므로 '/\evil.com'도 '//evil.com'(외부)이 된다. 그래서 막는다.
 */
export function toSafeRedirectPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > REDIRECT_PATH_MAX) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  if (UNSAFE_PATH_CHARS.test(value)) return null;
  return value;
}

/** Cloudflare가 붙여 주는 실제 접속 IP (로컬 개발에서는 없을 수 있음) */
export function getClientIp(c: Context<AppEnv>): string {
  return c.req.header('cf-connecting-ip') || '0.0.0.0';
}
