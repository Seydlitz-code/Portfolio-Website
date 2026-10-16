const crypto = require('crypto');

/** Render·Railway 등 배포 환경 여부 (config/database.js와 동일 기준) */
function isProductionLike() {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.RAILWAY_ENVIRONMENT === 'production' ||
    Boolean(process.env.RAILWAY_ENVIRONMENT_NAME) ||
    process.env.RENDER === 'true'
  );
}

/**
 * 세션 서명 비밀키. 배포 환경에서 SESSION_SECRET이 없으면 기동을 중단한다
 * (소스에 공개된 기본값을 쓰면 누구나 세션 쿠키를 위조할 수 있음).
 */
function resolveSessionSecret() {
  const v = process.env.SESSION_SECRET != null ? String(process.env.SESSION_SECRET).trim() : '';
  if (v) {
    if (v.length < 32) {
      console.warn('[security] SESSION_SECRET이 32자 미만입니다. 더 긴 무작위 값을 권장합니다.');
    }
    return v;
  }
  if (isProductionLike()) {
    console.error('[security] SESSION_SECRET 환경변수가 설정되지 않았습니다. 무작위 긴 문자열로 설정한 뒤 재시작하세요.');
    console.error("  예) node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"");
    process.exit(1);
  }
  console.warn('[security] 개발 모드: SESSION_SECRET 미설정 — 프로세스마다 임시 키를 사용합니다(재시작 시 로그아웃).');
  return crypto.randomBytes(48).toString('hex');
}

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

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

function hostnameOf(value) {
  if (!value) return '';
  try {
    return new URL(value).hostname.toLowerCase();
  } catch (_) {
    return '';
  }
}

/**
 * 상태 변경 요청(POST/PUT/DELETE 등)은 같은 사이트에서 온 것만 허용 (CSRF 방어).
 * 브라우저가 붙이는 Origin(없으면 Referer) 헤더의 호스트를 요청 호스트와 비교한다.
 * 두 헤더가 모두 없으면(일부 구형/프라이버시 설정) sameSite=lax 쿠키 정책에 맡긴다.
 */
function sameOriginGuard(req, res, next) {
  const m = req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next();
  const origin = req.get('origin');
  const source = origin && origin !== 'null' ? origin : req.get('referer');
  if (!source) {
    if (origin === 'null') return rejectCrossSite(req, res);
    return next();
  }
  const srcHost = hostnameOf(source);
  const allowed = new Set(
    [req.hostname, hostnameOf('http://' + (req.get('host') || ''))]
      .filter(Boolean)
      .map((h) => String(h).toLowerCase())
  );
  if (srcHost && allowed.has(srcHost)) return next();
  return rejectCrossSite(req, res);
}

function rejectCrossSite(req, res) {
  if ((req.get('accept') || '').includes('application/json')) {
    return res.status(403).json({ error: '허용되지 않은 요청 출처입니다.' });
  }
  return res.status(403).render('error', { code: 403, message: '허용되지 않은 요청 출처입니다.' });
}

/**
 * 고정 시간 창 기반 메모리 카운터 (단일 인스턴스용).
 * hit(key)로 증가, isLimited(key)로 한도 초과 확인, reset(key)로 초기화.
 */
function createWindowCounter({ windowMs, max }) {
  const store = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now - v.start >= windowMs) store.delete(k);
    }
  }, Math.min(windowMs, 10 * 60 * 1000));
  if (typeof timer.unref === 'function') timer.unref();

  function entry(key) {
    const now = Date.now();
    let e = store.get(key);
    if (!e || now - e.start >= windowMs) {
      e = { start: now, count: 0 };
      store.set(key, e);
    }
    return e;
  }

  return {
    hit(key) {
      entry(key).count += 1;
    },
    isLimited(key) {
      const e = store.get(key);
      return Boolean(e && Date.now() - e.start < windowMs && e.count >= max);
    },
    reset(key) {
      store.delete(key);
    }
  };
}

/** <script> 안에 JSON을 넣을 때 </script> 탈출·HTML 주석 해석 방지 */
/* JSON 문자열 안의 < > & 와 줄 구분자(U+2028/2029)를 유니코드 이스케이프로 바꿈 */
const SCRIPT_UNSAFE_CHARS = new RegExp("[<>&" + String.fromCharCode(0x2028, 0x2029) + "]", "g");

function jsonForScript(value) {
  return JSON.stringify(value).replace(
    SCRIPT_UNSAFE_CHARS,
    (ch) => String.fromCharCode(92) + "u" + ch.charCodeAt(0).toString(16).padStart(4, "0")
  );
}

module.exports = {
  isProductionLike,
  resolveSessionSecret,
  securityHeaders,
  sameOriginGuard,
  createWindowCounter,
  jsonForScript
};
