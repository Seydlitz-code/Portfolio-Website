/**
 * 통합·브라우저 테스트 공용: 앱 서버 기동, DB 초기화, 쿠키를 유지하는 HTTP 클라이언트.
 *
 * DB 선택: TEST_DATABASE_URL이 있으면 PostgreSQL, 없으면 임시 폴더의 SQLite.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ADMIN = { username: 'testadmin', password: 'testpass123' };
const SESSION_SECRET = 'ci-session-secret-0123456789abcdef0123456789';

function usingPostgres() {
  return Boolean(process.env.TEST_DATABASE_URL);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** PG: public 스키마를 비워 테스트 파일마다 깨끗한 DB에서 시작 */
async function resetPostgres() {
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.TEST_DATABASE_URL, ssl: false });
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS public CASCADE');
  await c.query('CREATE SCHEMA public');
  await c.end();
}

/** 새 DB 환경변수 세트 (SQLite는 새 임시 폴더, PG는 스키마 초기화) */
async function freshDbEnv() {
  if (usingPostgres()) {
    await resetPostgres();
    return { DATABASE_URL: process.env.TEST_DATABASE_URL, PGSSLMODE: 'disable' };
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-test-'));
  return { DATA_DIR: dir };
}

function baseEnv(extra) {
  const env = { ...process.env };
  ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PUBLIC_URL', 'POSTGRES_PRIVATE_URL', 'DATA_DIR', 'NODE_ENV',
    'RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_NAME', 'RENDER', 'SESSION_SECRET'].forEach((k) => delete env[k]);
  return { ...env, ...extra };
}

/**
 * server.js를 자식 프로세스로 기동. 준비 로그가 나오면 resolve.
 * @returns {{ base, stop, logs, dbEnv }}
 */
async function startServer({ dbEnv, env = {}, timeoutMs = 30000 } = {}) {
  const port = await freePort();
  const childEnv = baseEnv({
    ...dbEnv,
    PORT: String(port),
    SESSION_SECRET,
    ADMIN_BOOTSTRAP_USERNAME: ADMIN.username,
    ADMIN_BOOTSTRAP_PASSWORD: ADMIN.password,
    ...env
  });
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (d) => (logs += d));
  child.stderr.on('data', (d) => (logs += d));

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('서버 기동 시간 초과\n' + logs)), timeoutMs);
    const onData = () => {
      if (logs.includes('포트폴리오 서버 실행 중')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`서버가 종료됨 (code ${code})\n${logs}`));
    });
  });

  return {
    base: `http://127.0.0.1:${port}`,
    dbEnv,
    logs: () => logs,
    stop: async () => {
      await new Promise((resolve) => {
        if (child.exitCode != null) return resolve();
        child.once('exit', () => resolve());
        child.kill();
      });
      if (dbEnv && dbEnv.DATA_DIR) fs.rmSync(dbEnv.DATA_DIR, { recursive: true, force: true });
    }
  };
}

/** server.js를 기동만 해보고 종료 코드·출력 반환 (기동 실패 검증용) */
function runServerExpectExit({ dbEnv, env = {}, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: ROOT,
      env: baseEnv({ ...dbEnv, PORT: '0', ...env }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('서버가 종료되지 않음(기동 성공으로 보임)\n' + out));
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

/** 쿠키 유지 HTTP 클라이언트. 리다이렉트는 따라가지 않는다. */
class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  storeCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    list.forEach((line) => {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (/expires=Thu, 01 Jan 1970/i.test(line) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    });
  }

  /**
   * @param {string} method
   * @param {string} urlPath
   * @param {{ form?: object, body?: any, headers?: object, origin?: string|false }} [opts]
   */
  async request(method, urlPath, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    if (method !== 'GET' && method !== 'HEAD' && opts.origin !== false && !('Origin' in headers)) {
      headers.Origin = opts.origin || this.base;
    }
    let body = opts.body;
    if (opts.form) {
      body = new URLSearchParams(opts.form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const res = await fetch(this.base + urlPath, { method, headers, body, redirect: 'manual' });
    this.storeCookies(res);
    const buf = Buffer.from(await res.arrayBuffer());
    return {
      status: res.status,
      headers: res.headers,
      location: res.headers.get('location'),
      buffer: buf,
      text: buf.toString('utf8'),
      json() {
        return JSON.parse(buf.toString('utf8'));
      }
    };
  }

  get(p, o) {
    return this.request('GET', p, o);
  }

  post(p, form, o = {}) {
    return this.request('POST', p, { ...o, form });
  }

  async login(username = ADMIN.username, password = ADMIN.password) {
    const r = await this.post('/auth/login', { username, password });
    if (r.status !== 302) throw new Error(`로그인 실패 ${username}: ${r.status}`);
    return r;
  }

  /** 회원가입 페이지를 열고 캡차 정답 반환 */
  async captchaAnswer() {
    const r = await this.get('/auth/register');
    const m = /(\d+) \+ (\d+) = \?/.exec(r.text);
    if (!m) throw new Error('캡차 문제를 찾지 못함');
    return Number(m[1]) + Number(m[2]);
  }

  async register(fields) {
    const captcha = await this.captchaAnswer();
    return this.post('/auth/register', { password: 'password1', passwordConfirm: 'password1', captcha, ...fields });
  }

  /** 게시물 생성 → 새 게시물 id */
  async createPost({ title = '제목', content = '<p>본문</p>', project_id = '1' } = {}) {
    const r = await this.post('/posts', { title, content, project_id });
    const m = /^\/posts\/(\d+)$/.exec(r.location || '');
    if (r.status !== 302 || !m) throw new Error(`게시물 생성 실패: ${r.status} ${r.location}\n${r.text.slice(0, 300)}`);
    return Number(m[1]);
  }

  /** 본문 첨부 업로드 → { status, url } */
  async uploadBody(buffer, mime, filename = 'file.bin') {
    const fd = new FormData();
    fd.append('file', new Blob([buffer], { type: mime }), filename);
    const r = await this.request('POST', '/posts/body-upload', { body: fd, headers: { Accept: 'application/json' } });
    let url = null;
    try {
      url = r.json().url || null;
    } catch (_) {
      /* 오류 응답 */
    }
    return { status: r.status, url };
  }
}

/** 형식별 최소 파일 바이트 */
const FIXTURES = {
  png: () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]),
  mp4: (size = 300000) => {
    const head = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');
    const body = Buffer.alloc(size);
    for (let i = 0; i < size; i += 1) body[i] = (i * 31 + 7) & 0xff;
    return Buffer.concat([head, body]);
  },
  junk: (size = 5000) => Buffer.from('this is not a media file '.repeat(Math.ceil(size / 25)).slice(0, size))
};

module.exports = {
  ROOT,
  ADMIN,
  usingPostgres,
  freshDbEnv,
  startServer,
  runServerExpectExit,
  Client,
  FIXTURES
};
