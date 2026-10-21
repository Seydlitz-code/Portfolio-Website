/**
 * 통합 테스트 공용 (기존 test/helpers.js 이식).
 * 임시 폴더에 새 로컬 D1·R2 상태를 만들고 `wrangler dev`를 띄운 뒤, 쿠키를 유지하는 HTTP 클라이언트로 요청한다.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER = join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
export const ADMIN = { username: 'testadmin', password: 'testpass123' };
const AUTH_SECRET = 'ci-auth-secret-0123456789abcdef0123456789abcdef';

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

function wrangler(args, { input } = {}) {
  const r = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }
  });
  if (r.status !== 0) throw new Error(`wrangler ${args.join(' ')} 실패\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

/** 로컬 D1에 SQL 실행 (테스트 사전 조건 조작용) → 마지막 문장의 결과 행 */
export function d1(persistDir, sql) {
  const out = wrangler(['d1', 'execute', 'portfolio-db', '--local', '--persist-to', persistDir, '--json', '--command', sql]);
  const json = JSON.parse(out.slice(out.indexOf('[')));
  return json[json.length - 1]?.results ?? [];
}

function killTree(child) {
  if (child.exitCode != null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else child.kill('SIGTERM');
  });
}

/**
 * 새 상태로 마이그레이션 → 관리자 생성 → wrangler dev 기동.
 * @returns {{ base, persistDir, stop, logs }}
 */
export async function startServer({ timeoutMs = 90000 } = {}) {
  const persistDir = mkdtempSync(join(tmpdir(), 'portfolio-cf-test-'));
  wrangler(['d1', 'migrations', 'apply', 'portfolio-db', '--local', '--persist-to', persistDir]);
  const adm = spawnSync(process.execPath, [join(ROOT, 'scripts', 'admin.mjs'), 'create', '--local', `--persist-to=${persistDir}`], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ADMIN_USERNAME: ADMIN.username, ADMIN_NICKNAME: '관리자', ADMIN_PASSWORD: ADMIN.password }
  });
  if (adm.status !== 0) throw new Error(`관리자 생성 실패\n${adm.stdout}\n${adm.stderr}`);

  const port = await freePort();
  const child = spawn(
    process.execPath,
    [WRANGLER, 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persistDir, '--var', `AUTH_SECRET:${AUTH_SECRET}`, '--test-scheduled'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } }
  );
  let logs = '';
  child.stdout.on('data', (d) => (logs += d));
  child.stderr.on('data', (d) => (logs += d));
  const base = `http://127.0.0.1:${port}`;

  const started = Date.now();
  for (;;) {
    if (child.exitCode != null) throw new Error(`wrangler dev 종료됨\n${logs}`);
    if (Date.now() - started > timeoutMs) {
      await killTree(child);
      throw new Error(`wrangler dev 기동 시간 초과\n${logs}`);
    }
    try {
      const r = await fetch(base + '/healthz');
      if (r.ok) break;
    } catch {
      /* 아직 준비 안 됨 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return {
    base,
    persistDir,
    logs: () => logs,
    stop: async () => {
      await killTree(child);
      // Windows는 프로세스를 끈 직후 파일 잠금이 잠시 남아 있어 기다렸다가 재시도한다.
      await new Promise((r) => setTimeout(r, 1500));
      try {
        rmSync(persistDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
      } catch (err) {
        console.warn(`[test] 임시 폴더를 지우지 못함: ${persistDir} (${err.code})`);
      }
    }
  };
}

/** 쿠키 유지 HTTP 클라이언트. 리다이렉트는 따라가지 않는다. */
export class Client {
  constructor(base) {
    this.base = base;
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  storeCookies(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (/max-age=0\b/i.test(line) || /expires=Thu, 01 Jan 1970/i.test(line) || value === '') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

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
    if (r.status !== 302) throw new Error(`로그인 실패 ${username}: ${r.status}\n${r.text.slice(0, 300)}`);
    return r;
  }

  /** 회원가입 페이지를 열고 보안 문자 정답 반환 */
  async captchaAnswer() {
    const r = await this.get('/auth/register');
    const m = /(\d+) \+ (\d+) = \?/.exec(r.text);
    if (!m) throw new Error('보안 문자를 찾지 못함');
    return Number(m[1]) + Number(m[2]);
  }

  async register(fields) {
    const captcha = await this.captchaAnswer();
    return this.post('/auth/register', { password: 'password1', passwordConfirm: 'password1', captcha, ...fields });
  }

  async createPost({ title = '제목', content = '<p>본문</p>', project_id = '1' } = {}) {
    const r = await this.post('/posts', { title, content, project_id });
    const m = /^\/posts\/(\d+)$/.exec(r.location || '');
    if (r.status !== 302 || !m) throw new Error(`게시물 생성 실패: ${r.status} ${r.location}\n${r.text.slice(0, 300)}`);
    return Number(m[1]);
  }

  async uploadBody(buffer, mime, filename = 'file.bin') {
    const fd = new FormData();
    fd.append('file', new Blob([buffer], { type: mime }), filename);
    const r = await this.request('POST', '/posts/body-upload', { body: fd, headers: { Accept: 'application/json' } });
    let url = null;
    try {
      url = r.json().url || null;
    } catch {
      /* 오류 응답 */
    }
    return { status: r.status, url };
  }
}

/** 형식별 최소 파일 바이트 */
export const FIXTURES = {
  png: () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]),
  mp4: (size = 300000) => {
    const head = Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');
    const body = Buffer.alloc(size);
    for (let i = 0; i < size; i += 1) body[i] = (i * 31 + 7) & 0xff;
    return Buffer.concat([head, body]);
  },
  junk: (size = 5000) => Buffer.from('this is not a media file '.repeat(Math.ceil(size / 25)).slice(0, size))
};
