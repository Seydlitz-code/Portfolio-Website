/**
 * HTTP 통합 테스트: 실제 server.js를 띄워 보안·기능 동작을 확인한다.
 * DB는 TEST_DATABASE_URL 유무로 PostgreSQL / SQLite 중 하나 (helpers.js 참고).
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { freshDbEnv, startServer, Client, FIXTURES, ADMIN } = require('../helpers');

function kstListTime(iso) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
    .formatToParts(new Date(iso))
    .reduce((o, x) => ((o[x.type] = x.value), o), {});
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}`;
}

let server;
let admin;
let boardId;

before(async () => {
  server = await startServer({ dbEnv: await freshDbEnv() });
  admin = new Client(server.base);
  await admin.login();
  const r = await admin.post('/admin/projects', { name: '테스트', name_ja: 'テスト', description: '설명' });
  assert.equal(r.status, 302);
  boardId = '1';
});

after(async () => {
  if (server) await server.stop();
});

describe('기본 페이지·ID 검증', () => {
  const guest = () => new Client(server.base);

  for (const p of ['/', '/posts', '/auth/login', '/auth/register', `/boards/1`]) {
    it(`GET ${p} → 200`, async () => {
      assert.equal((await guest().get(p)).status, 200);
    });
  }

  for (const p of ['/posts/abc', '/posts/99999999999', '/boards/abc', '/media/post-body/99999999999', '/media/user/abc/avatar', '/nope']) {
    it(`GET ${p} → 404 (500 아님)`, async () => {
      assert.equal((await guest().get(p)).status, 404);
    });
  }

  it('비로그인 /mypage → 로그인으로', async () => {
    const r = await guest().get('/mypage');
    assert.equal(r.status, 302);
    assert.match(r.location, /^\/auth\/login/);
  });
});

describe('보안 헤더', () => {
  it('CSP·nosniff·X-Frame-Options 설정, X-Powered-By 없음', async () => {
    const r = await new Client(server.base).get('/');
    assert.match(r.headers.get('content-security-policy') || '', /object-src 'none'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(r.headers.get('x-powered-by'), null);
  });
});

describe('세션', () => {
  it('로그인 시 세션 ID가 바뀐다 (세션 고정 방지)', async () => {
    const c = new Client(server.base);
    await c.get('/auth/register');
    const before = c.cookies.get('portfolio.sid');
    assert.ok(before, '로그인 전 세션 쿠키가 있어야 함');
    await c.login();
    const afterSid = c.cookies.get('portfolio.sid');
    assert.notEqual(afterSid, before);
    assert.equal((await c.get('/mypage/main-settings')).status, 200);

    const stale = new Client(server.base);
    stale.cookies.set('portfolio.sid', before);
    const r = await stale.get('/mypage/main-settings');
    assert.equal(r.status, 302, '이전 세션 ID는 비로그인 취급');
  });

  it('삭제된 계정의 세션은 로그인 화면으로 (이전: 404)', async () => {
    const c = new Client(server.base);
    assert.equal((await c.register({ nickname: 'ghost', username: 'ghost_user' })).status, 302);
    await c.login('ghost_user', 'password1');
    const db = await openAppDb();
    const row = await db.get('SELECT id FROM users WHERE username = ?', ['ghost_user']);
    await db.run('DELETE FROM users WHERE id = ?', [row.id]);
    await db.close();
    const r = await c.get('/mypage');
    assert.equal(r.status, 302);
    assert.equal(r.location, '/auth/login');
  });
});

describe('오픈 리다이렉트', () => {
  for (const [next, want] of [
    ['/%5Cevil.com', '/'],
    ['//evil.com', '/'],
    ['/posts', '/posts']
  ]) {
    it(`next=${decodeURIComponent(next)} → ${want}`, async () => {
      const r = await admin.get(`/auth/login?next=${next}`);
      assert.equal(r.status, 302);
      assert.equal(r.location, want);
    });
  }
});

describe('CSRF: 교차 출처 상태 변경 차단', () => {
  const form = { name: 'x', name_ja: 'x', description: 'x' };
  it('외부 Origin → 403', async () => {
    assert.equal((await admin.post('/admin/projects', form, { origin: 'https://evil.com' })).status, 403);
  });
  it('외부 Referer(Origin 없음) → 403', async () => {
    const r = await admin.request('POST', '/admin/projects', { form, origin: false, headers: { Referer: 'https://evil.com/x' } });
    assert.equal(r.status, 403);
  });
  it('Origin: null → 403', async () => {
    assert.equal((await admin.post('/admin/projects', form, { headers: { Origin: 'null' } })).status, 403);
  });
});

describe('게시물 HTML 정제', () => {
  let html;
  before(async () => {
    const payload =
      '<p>ok</p><img/onerror=alert(1) src=x><a href="javajavascript:script:alert(2)">x</a>' +
      '<iframe srcdoc="&lt;script&gt;alert(3)&lt;/script&gt;"></iframe><iframe src="https://evil.com/"></iframe>' +
      '<span style="color: red; background:url(javascript:alert(4))">red</span>';
    const id = await admin.createPost({ title: 'xss', content: payload, project_id: boardId });
    html = (await new Client(server.base).get(`/posts/${id}`)).text;
  });
  it('이벤트 핸들러 제거', () => assert.doesNotMatch(html, /onerror=alert/));
  it('javascript: URL 제거', () => assert.doesNotMatch(html, /javascript:alert/));
  it('srcdoc·외부 iframe 제거', () => {
    assert.doesNotMatch(html, /srcdoc/);
    assert.doesNotMatch(html, /evil\.com/);
  });
  it('정상 서식은 유지', () => assert.match(html, /style="color:red"/));
});

describe('조회수·시간 표시', () => {
  let id;
  before(async () => {
    id = await admin.createPost({ title: '조회수', project_id: boardId });
  });

  it('같은 방문자의 반복 조회는 1회만 집계', async () => {
    const g = new Client(server.base);
    const counts = [];
    for (let i = 0; i < 3; i += 1) counts.push(/조회 (\d+)/.exec((await g.get(`/posts/${id}`)).text)[1]);
    assert.deepEqual(counts, ['1', '1', '1']);
  });

  it('datetime은 ISO UTC, 서버 기본 표시는 한국 시간', async () => {
    const html = (await new Client(server.base).get(`/posts/${id}`)).text;
    const m = /datetime="([^"]+)" data-local-time="list">([^<]+)</.exec(html);
    assert.ok(m, 'time 요소');
    assert.match(m[1], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    assert.ok(Math.abs(Date.now() - new Date(m[1]).getTime()) < 5 * 60 * 1000, 'ISO 시각이 현재와 일치');
    assert.equal(m[2], kstListTime(m[1]));
  });
});

describe('본문 첨부: 형식 검증·Range·정리', () => {
  const mp4 = FIXTURES.mp4();
  let url;

  it('내용이 미디어가 아니면 거부 (MIME만 속인 파일)', async () => {
    assert.equal((await admin.uploadBody(FIXTURES.junk(), 'video/mp4', 'fake.mp4')).status, 400);
  });

  it('mp4 시그니처 파일 업로드', async () => {
    const r = await admin.uploadBody(mp4, 'video/mp4', 'real.mp4');
    assert.equal(r.status, 200);
    assert.match(r.url, /^\/media\/post-body\/\d+$/);
    url = r.url;
  });

  it('Range bytes=0-1 → 206 + Content-Range', async () => {
    const r = await new Client(server.base).get(url, { headers: { Range: 'bytes=0-1' } });
    assert.equal(r.status, 206);
    assert.equal(r.headers.get('content-range'), `bytes 0-1/${mp4.length}`);
    assert.ok(r.buffer.equals(mp4.subarray(0, 2)));
  });

  it('중간·끝(suffix) 범위 내용 일치', async () => {
    const g = new Client(server.base);
    const mid = await g.get(url, { headers: { Range: 'bytes=1000-200999' } });
    assert.ok(mid.buffer.equals(mp4.subarray(1000, 201000)));
    const tail = await g.get(url, { headers: { Range: 'bytes=-500' } });
    assert.ok(tail.buffer.equals(mp4.subarray(mp4.length - 500)));
  });

  it('범위 밖 → 416, Range 없음 → 전체', async () => {
    const g = new Client(server.base);
    assert.equal((await g.get(url, { headers: { Range: 'bytes=99999999-' } })).status, 416);
    const full = await g.get(url);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.ok(full.buffer.equals(mp4));
  });

  it('수정으로 본문에서 빠진 첨부는 삭제', async () => {
    const id = await admin.createPost({ title: 'media', content: `<p><video src="${url}" controls></video></p>`, project_id: boardId });
    const r = await admin.post(`/posts/${id}?_method=PUT`, { title: 'media', content: '<p>텍스트만</p>', project_id: boardId });
    assert.equal(r.status, 302);
    assert.equal((await new Client(server.base).get(url)).status, 404);
  });

  it('게시물 삭제 시 첨부도 삭제', async () => {
    const up = await admin.uploadBody(mp4, 'video/mp4');
    const id = await admin.createPost({ title: 'media2', content: `<p><video src="${up.url}"></video></p>`, project_id: boardId });
    assert.equal((await new Client(server.base).get(up.url)).status, 200);
    assert.equal((await admin.post(`/posts/${id}?_method=DELETE`, {})).status, 302);
    assert.equal((await new Client(server.base).get(up.url)).status, 404);
  });
});

describe('게시물 수정 검증', () => {
  let id;
  before(async () => {
    id = await admin.createPost({ title: '수정대상', project_id: boardId });
  });
  it('없는 게시판 → 400 (이전: 500)', async () => {
    assert.equal((await admin.post(`/posts/${id}?_method=PUT`, { title: 't', content: 'hello', project_id: '9999' })).status, 400);
  });
  it('게시판 값이 숫자가 아님 → 400', async () => {
    assert.equal((await admin.post(`/posts/${id}?_method=PUT`, { title: 't', content: 'hello', project_id: 'abc' })).status, 400);
  });
  it('분류 없음(빈 값) 허용', async () => {
    assert.equal((await admin.post(`/posts/${id}?_method=PUT`, { title: 't', content: 'hello', project_id: '' })).status, 302);
  });
  it('없는 게시물 → 404', async () => {
    assert.equal((await admin.post('/posts/99999?_method=PUT', { title: 't', content: 'hello', project_id: '' })).status, 404);
  });
});

describe('회원가입', () => {
  it('정상 가입 → 로그인 화면', async () => {
    const r = await new Client(server.base).register({ nickname: 'nick1', username: 'user_one' });
    assert.equal(r.status, 302);
    assert.equal(r.location, '/auth/login?registered=true');
  });

  it('같은 캡차 정답 재사용 거부', async () => {
    const c = new Client(server.base);
    const captcha = await c.captchaAnswer();
    const base = { password: 'password1', passwordConfirm: 'password1', captcha };
    assert.equal((await c.post('/auth/register', { ...base, nickname: 'nick2', username: 'user_two' })).status, 302);
    const again = await c.post('/auth/register', { ...base, nickname: 'nick3', username: 'user_three' });
    assert.equal(again.status, 200, '에러 화면 재표시');
    assert.match(again.text, /보안 문자/);
  });

  it('아이디 31자 이상 거부', async () => {
    const r = await new Client(server.base).register({ nickname: 'longid', username: 'u'.repeat(31) });
    assert.equal(r.status, 200);
  });

  it('닉네임 21자 이상 거부', async () => {
    const r = await new Client(server.base).register({ nickname: 'n'.repeat(21), username: 'user_four' });
    assert.equal(r.status, 200);
  });

  it('내용이 이미지가 아닌 아바타 거부', async () => {
    const c = new Client(server.base);
    const captcha = await c.captchaAnswer();
    const fd = new FormData();
    Object.entries({ nickname: 'nick5', username: 'user_five', password: 'password1', passwordConfirm: 'password1', captcha }).forEach(([k, v]) =>
      fd.append(k, String(v))
    );
    fd.append('avatar', new Blob([FIXTURES.junk()], { type: 'image/png' }), 'fake.png');
    const r = await c.request('POST', '/auth/register', { body: fd });
    assert.equal(r.status, 200);
    assert.match(r.text, /JPG, PNG, GIF, WEBP/);
  });
});

describe('권한·댓글·알림', () => {
  let user;
  let postId;
  before(async () => {
    user = new Client(server.base);
    await user.login('user_one', 'password1');
    postId = await admin.createPost({ title: '댓글대상', project_id: boardId });
  });

  it('일반 회원은 관리자 기능 접근 불가', async () => {
    assert.equal((await user.get('/api/notifications')).status, 403);
    assert.equal((await user.get('/posts/new')).status, 403);
    assert.equal((await user.post(`/posts/${postId}?_method=DELETE`, {})).status, 403);
  });

  it('없는 게시물에 댓글 → 404 (이전: 500)', async () => {
    assert.equal((await user.post('/posts/99999/comments', { content: 'hi' })).status, 404);
  });

  it('댓글 작성 → 관리자 알림 (createdAt은 ISO UTC)', async () => {
    assert.equal((await user.post(`/posts/${postId}/comments`, { content: '안녕하세요 댓글' })).status, 302);
    const r = await admin.get('/api/notifications', { headers: { Accept: 'application/json' } });
    const data = r.json();
    assert.ok(data.unreadCount >= 1);
    const item = data.items.find((x) => x.postId === postId);
    assert.ok(item, '해당 게시물 알림');
    assert.equal(item.excerpt, '안녕하세요 댓글');
    assert.match(item.createdAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it('댓글 시간에 data-local-time 표시', async () => {
    const html = (await new Client(server.base).get(`/posts/${postId}`)).text;
    assert.match(html, /data-local-time="comment"/);
  });
});

describe('목록·글 번호 (윈도 함수)', () => {
  it('메인·전체·게시판 목록의 번호가 전체 기준 순번과 일치', async () => {
    const r = await admin.post('/admin/projects', { name: 'B게시판', name_ja: 'B', description: 'd' });
    assert.equal(r.status, 302);
    const boardB = '2';
    for (let i = 1; i <= 6; i += 1) await admin.createPost({ title: `A${i}`, project_id: boardId });
    for (let i = 1; i <= 2; i += 1) await admin.createPost({ title: `B${i}`, project_id: boardB });

    const nums = (html) => [...html.matchAll(/board-td--num">(\d+)/g)].map((m) => Number(m[1]));
    const all = nums((await admin.get('/posts')).text);
    const total = all.length;
    assert.deepEqual(all, Array.from({ length: total }, (_, i) => total - i), '전체 목록은 total..1');

    const b = nums((await admin.get(`/boards/${boardB}`)).text);
    assert.deepEqual(b, [total, total - 1], 'B게시판은 가장 최근 두 번호');

    const home = nums((await admin.get('/')).text);
    assert.deepEqual(home.slice(0, 5), [total, total - 1, total - 2, total - 3, total - 4], '메인 최근 5개');
    const boardAOnHome = home.slice(5, 10);
    assert.equal(boardAOnHome.length, 5, '게시판별 최대 5개');
    assert.deepEqual(boardAOnHome, [total - 2, total - 3, total - 4, total - 5, total - 6]);
  });
});

describe('로그인 시도 제한 (마지막에 실행: 관리자 계정이 15분 잠김)', () => {
  it('8회 실패 후 429, 올바른 비밀번호도 차단', async () => {
    const c = new Client(server.base);
    let last;
    for (let i = 0; i < 9; i += 1) last = await c.post('/auth/login', { username: ADMIN.username, password: `wrong${i}` });
    assert.equal(last.status, 429);
    assert.equal((await c.post('/auth/login', ADMIN)).status, 429);
  });
});

/** 테스트 프로세스에서 앱과 같은 DB에 직접 접속 (계정 삭제 등 사전 조건 조작용) */
async function openAppDb() {
  const env = server.dbEnv;
  if (env.DATABASE_URL) {
    const { Client: PgClient } = require('pg');
    const c = new PgClient({ connectionString: env.DATABASE_URL, ssl: false });
    await c.connect();
    const toPg = (sql) => {
      let i = 0;
      return sql.replace(/\?/g, () => `$${++i}`);
    };
    return {
      get: async (sql, p) => (await c.query(toPg(sql), p)).rows[0],
      run: async (sql, p) => c.query(toPg(sql), p),
      close: () => c.end()
    };
  }
  const Database = require('better-sqlite3');
  const d = new Database(require('path').join(env.DATA_DIR, 'portfolio.db'));
  d.pragma('foreign_keys = ON');
  return {
    get: async (sql, p) => d.prepare(sql).get(...p),
    run: async (sql, p) => d.prepare(sql).run(...p),
    close: async () => d.close()
  };
}
