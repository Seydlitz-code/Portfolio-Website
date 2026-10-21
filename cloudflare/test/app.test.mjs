/**
 * HTTP 통합 테스트: wrangler dev로 Worker를 띄워 기능·보안 동작을 확인한다.
 * 기존 test/integration/app.test.js의 항목을 그대로 옮기고, Workers 버전에서 새로 생긴 동작을 더했다.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, FIXTURES, ADMIN, d1 } from './helpers.mjs';

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
const boardId = '1';

before(async () => {
  server = await startServer();
  admin = new Client(server.base);
  await admin.login();
  const r = await admin.post('/admin/projects', { name: '테스트', name_ja: 'テスト', description: '설명' });
  assert.equal(r.status, 302);
});

after(async () => {
  if (server) await server.stop();
});

describe('기본 페이지·ID 검증', () => {
  const guest = () => new Client(server.base);

  for (const p of ['/', '/posts', '/auth/login', '/auth/register', '/boards/1']) {
    it(`GET ${p} → 200`, async () => {
      assert.equal((await guest().get(p)).status, 200);
    });
  }

  for (const p of ['/posts/abc', '/posts/99999999999', '/boards/abc', '/media/post-body/99999999999', '/media/user/abc/avatar', '/nope']) {
    it(`GET ${p} → 404 (500 아님)`, async () => {
      assert.equal((await guest().get(p)).status, 404);
    });
  }

  it('헬스체크(/healthz)는 200·JSON, 쿠키 없음, no-store', async () => {
    const res = await fetch(server.base + '/healthz');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(res.headers.getSetCookie().length, 0);
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });

  it('끝에 /가 붙은 주소도 같은 화면', async () => {
    assert.equal((await guest().get('/posts/')).status, 200);
    assert.equal((await guest().get('/boards/1/')).status, 200);
  });

  it('없는 사용자의 아바타 → 404', async () => {
    assert.equal((await guest().get('/media/user/999999/avatar')).status, 404);
  });

  it('비로그인 /mypage → 로그인으로', async () => {
    const r = await guest().get('/mypage');
    assert.equal(r.status, 302);
    assert.match(r.location, /^\/auth\/login/);
  });

  it('모든 화면에 DOCTYPE', async () => {
    for (const p of ['/', '/posts', '/boards/1', '/auth/login', '/nope']) {
      assert.match((await guest().get(p)).text, /^<!DOCTYPE html>/, p);
    }
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
  it('로그인마다 새 세션, 로그아웃한 세션은 무효', async () => {
    const c = new Client(server.base);
    await c.login();
    const first = c.cookies.get('portfolio_sid');
    assert.ok(first);
    assert.equal((await c.get('/mypage/main-settings')).status, 200);
    await c.post('/auth/logout', {});
    const stale = new Client(server.base);
    stale.cookies.set('portfolio_sid', first);
    assert.equal((await stale.get('/mypage/main-settings')).status, 302, '로그아웃한 세션은 비로그인 취급');

    const again = new Client(server.base);
    await again.login();
    assert.notEqual(again.cookies.get('portfolio_sid'), first);
  });

  it('삭제된 계정의 세션은 로그인 화면으로', async () => {
    const c = new Client(server.base);
    assert.equal((await c.register({ nickname: 'ghost', username: 'ghost_user' })).status, 302);
    await c.login('ghost_user', 'password1');
    d1(server.persistDir, "DELETE FROM users WHERE username = 'ghost_user'");
    const r = await c.get('/mypage');
    assert.equal(r.status, 302);
    assert.match(r.location, /^\/auth\/login/);
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
  it('_method로 바꾼 요청도 출처 검사', async () => {
    assert.equal((await admin.post('/admin/projects/1?_method=DELETE', {}, { origin: 'https://evil.com' })).status, 403);
  });
});

describe('게시물 HTML 정제', () => {
  let html;
  before(async () => {
    const payload =
      '<p>ok</p><img/onerror=alert(1) src=x><a href="javajavascript:script:alert(2)">x</a>' +
      '<iframe srcdoc="&lt;script&gt;alert(3)&lt;/script&gt;"></iframe><iframe src="https://evil.com/"></iframe>' +
      '<span style="color: red; background:url(javascript:alert(4))">red</span>' +
      '<script>alert(5)</script><a href="&#106;avascript:alert(6)">y</a><a href="  JaVaScRiPt:alert(7)">z</a>' +
      '<svg><script>alert(8)</script></svg><a href="//evil.example/x">p</a><!-- secret -->' +
      '<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk"></iframe><a href="/posts" target="_blank">in</a>';
    const id = await admin.createPost({ title: 'xss', content: payload, project_id: boardId });
    html = (await new Client(server.base).get(`/posts/${id}`)).text;
  });
  it('이벤트 핸들러 제거', () => assert.doesNotMatch(html, /onerror=/));
  it('javascript: URL 제거 (엔티티·대소문자·공백 우회 포함)', () => {
    assert.doesNotMatch(html, /javascript:alert/i);
    assert.doesNotMatch(html, /&#106;avascript/);
  });
  it('srcdoc·외부 iframe 제거, YouTube iframe 유지', () => {
    assert.doesNotMatch(html, /srcdoc/);
    assert.doesNotMatch(html, /evil\.com/);
    assert.match(html, /src="https:\/\/www\.youtube-nocookie\.com\/embed\/abcdefghijk"/);
  });
  it('script 내용까지 제거', () => {
    assert.doesNotMatch(html, /alert\(5\)/);
    assert.doesNotMatch(html, /alert\(8\)/);
  });
  it('프로토콜 상대 주소·HTML 주석 제거', () => {
    assert.doesNotMatch(html, /evil\.example/);
    assert.doesNotMatch(html, /secret/);
  });
  it('원문 텍스트 태그(xmp 등)·CDATA·닫히지 않은 태그로 우회 불가 (검토에서 찾은 경로)', async () => {
    const vectors = [
      '<xmp><img src=x onerror=alert(11)></xmp>',
      '<xmp><xmp><img src=x onerror=alert(12)></xmp></xmp>',
      '<noembed><img src=x onerror=alert(13)></noembed>',
      '<title><img src=x onerror=alert(14)></title>',
      '<svg><![CDATA[><img src=x onerror=alert(15)>]]></svg>',
      '<p>a</p><img src=x onerror=alert(16) ',
      '<p>b</p><!-- open comment',
      '<span style="background:u&#114;l(https://evil.example/t)">s</span>'
    ];
    for (const v of vectors) {
      const id = await admin.createPost({ title: 'vec', content: `<p>본문</p>${v}`, project_id: boardId });
      const page = (await new Client(server.base).get(`/posts/${id}`)).text;
      const body = page.slice(page.indexOf('class="post-content'), page.indexOf('id="comments"'));
      assert.doesNotMatch(body, /<img[^>]*onerror/i, v);
      assert.doesNotMatch(body, /evil\.example/, v);
      // 저장된 원문도 안전해야 한다 (에디터가 innerHTML로 다시 넣음)
      const edit = (await admin.get(`/posts/${id}/edit`)).text;
      const init = JSON.parse(Buffer.from(/id="post-editor-init-b64" value="([^"]+)"/.exec(edit)[1], 'base64').toString('utf8'));
      assert.doesNotMatch(init.html, /<img[^>]*onerror/i, v);
      assert.match(page, /id="comments"/, '댓글 영역이 주석에 먹히지 않음');
    }
  });

  it('정상 서식은 유지, target=_blank에 rel 추가', () => {
    assert.match(html, /style="color:red"/);
    assert.match(html, /<a href="\/posts" target="_blank" rel="noopener noreferrer">in<\/a>/);
  });
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

  it('일반 회원은 업로드 불가', async () => {
    const u = new Client(server.base);
    assert.equal((await u.uploadBody(mp4, 'video/mp4')).status, 403);
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
    assert.equal(full.headers.get('content-type'), 'video/mp4');
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

describe('게시물 작성·수정 검증', () => {
  let id;
  before(async () => {
    id = await admin.createPost({ title: '수정대상', project_id: boardId });
  });
  it('없는 게시판 → 400', async () => {
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
  it('새 글: 게시판 미선택·본문 없음은 폼 재표시', async () => {
    const noBoard = await admin.post('/posts', { title: 't', content: '<p>x</p>', project_id: '' });
    assert.equal(noBoard.status, 200);
    assert.match(noBoard.text, /게시판을 선택해주세요/);
    const empty = await admin.post('/posts', { title: 't', content: '<p> </p>', project_id: boardId });
    assert.match(empty.text, /국문 제목과 본문/);
  });
  it('수정 폼에 기존 제목과 에디터 초기값', async () => {
    const r = await admin.get(`/posts/${id}/edit`);
    assert.equal(r.status, 200);
    const b64 = /id="post-editor-init-b64" value="([^"]+)"/.exec(r.text)[1];
    const init = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    assert.equal(init.titleKo, 't');
    assert.equal(init.html, 'hello');
  });
  it('게시판에서 새 글: 게시판 고정', async () => {
    const r = await admin.get(`/posts/new?project_id=${boardId}&cancel=%2Fboards%2F${boardId}`);
    assert.match(r.text, /name="_project_form_locked" value="1"/);
    assert.match(r.text, new RegExp(`name="_cancel_href" value="/boards/${boardId}"`));
  });
});

describe('회원가입', () => {
  it('정상 가입 → 로그인 화면', async () => {
    const r = await new Client(server.base).register({ nickname: 'nick1', username: 'user_one' });
    assert.equal(r.status, 302);
    assert.equal(r.location, '/auth/login?registered=true');
  });

  it('같은 보안 문자 정답 재사용 거부', async () => {
    const c = new Client(server.base);
    const captcha = await c.captchaAnswer();
    const base = { password: 'password1', passwordConfirm: 'password1', captcha };
    assert.equal((await c.post('/auth/register', { ...base, nickname: 'nick2', username: 'user_two' })).status, 302);
    const again = await c.post('/auth/register', { ...base, nickname: 'nick3', username: 'user_three' });
    assert.equal(again.status, 200, '오류 화면 재표시');
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
    for (const [k, v] of Object.entries({ nickname: 'nick5', username: 'user_five', password: 'password1', passwordConfirm: 'password1', captcha })) {
      fd.append(k, String(v));
    }
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
    assert.equal((await user.get('/mypage/main-settings')).status, 403);
    assert.equal((await user.post('/admin/projects', { name: 'a', name_ja: 'a', description: 'a' })).status, 403);
  });

  it('없는 게시물에 댓글 → 404', async () => {
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
    assert.equal(item.unread, true);
  });

  it('관리자 화면에 알림 점 표시, 모두 읽음 후 사라짐', async () => {
    assert.match((await admin.get('/posts')).text, /nav-notify-dot/);
    assert.deepEqual((await admin.post('/api/notifications/read-all', {}, { headers: { Accept: 'application/json' } })).json(), { ok: true });
    assert.doesNotMatch((await admin.get('/posts')).text, /nav-notify-dot/);
  });

  it('댓글 시간에 data-local-time 표시', async () => {
    const html = (await new Client(server.base).get(`/posts/${postId}`)).text;
    assert.match(html, /data-local-time="comment"/);
  });

  it('본인 댓글만 수정, 관리자는 삭제 가능', async () => {
    const html = (await user.get(`/posts/${postId}`)).text;
    const cid = /id="comment-view-(\d+)"/.exec(html)[1];
    assert.equal((await admin.post(`/posts/${postId}/comments/${cid}?_method=PUT`, { content: '남의 댓글' })).status, 403);
    assert.equal((await user.post(`/posts/${postId}/comments/${cid}?_method=PUT`, { content: '고친 댓글' })).status, 302);
    assert.match((await user.get(`/posts/${postId}`)).text, /고친 댓글/);
    assert.equal((await admin.post(`/posts/${postId}/comments/${cid}?_method=DELETE`, {})).status, 302);
    assert.doesNotMatch((await user.get(`/posts/${postId}`)).text, /고친 댓글/);
  });

  it('마이페이지 작성한 글: 댓글 목록과 삭제 후 next로 복귀', async () => {
    await user.post(`/posts/${postId}/comments`, { content: '마이페이지에서 지울 댓글' });
    const page = await user.get('/mypage/posts');
    assert.equal(page.status, 200);
    assert.match(page.text, /마이페이지에서 지울 댓글/);
    const m = /action="\/posts\/(\d+)\/comments\/(\d+)\?_method=DELETE"/.exec(page.text);
    const r = await user.post(`/posts/${m[1]}/comments/${m[2]}?_method=DELETE`, { next: '/mypage/posts' });
    assert.equal(r.location, '/mypage/posts');
  });
});

describe('관리자: 게시판·메인 설정', () => {
  it('게시판 수정·삭제 (숨김 필드 _method)', async () => {
    assert.equal((await admin.post('/admin/projects', { name: '임시', name_ja: '一時', description: 'd' })).status, 302);
    const list = (await admin.get('/mypage/boards')).text;
    const id = [...list.matchAll(/data-board-edit="(\d+)"/g)].map((m) => Number(m[1])).pop();
    const edit = await admin.post(`/admin/projects/${id}`, { _method: 'PUT', name: '임시2', name_ja: '一時2', description: 'd2' });
    assert.equal(edit.location, '/mypage/boards?editSaved=1');
    assert.match((await admin.get(`/boards/${id}`)).text, /임시2/);
    const del = await admin.post(`/admin/projects/${id}`, { _method: 'DELETE' });
    assert.equal(del.location, '/mypage/boards?deleted=1');
    assert.equal((await admin.get(`/boards/${id}`)).status, 404);
  });

  it('글이 있는 게시판은 삭제 불가', async () => {
    const r = await admin.post(`/admin/projects/${boardId}`, { _method: 'DELETE' });
    assert.equal(r.location, '/mypage/boards?deleteBlocked=1');
  });

  it('메인 페이지 설정: 이름·자기소개 정제, 프로필 이미지 저장', async () => {
    const fd = new FormData();
    fd.append('site_name', '<b>새 이름</b><script>x()</script>');
    fd.append('bio', '<p>소개</p><div><br></div><img src=x onerror=alert(1)>');
    fd.append('profile_image', new Blob([FIXTURES.png()], { type: 'image/png' }), 'p.png');
    const r = await admin.request('POST', '/admin/apply', { body: fd });
    assert.equal(r.location, '/mypage/main-settings?saved=1');
    const home = (await new Client(server.base).get('/')).text;
    assert.match(home, /<h1 class="hero-name"><b>새 이름<\/b><\/h1>/);
    assert.match(home, /<title>새 이름<\/title>/);
    assert.doesNotMatch(home, /onerror/);
    assert.match(home, /src="\/media\/site\/profile-image"/);
    const img = await new Client(server.base).get('/media/site/profile-image');
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/png');
  });

  it('메인 페이지 이름은 비울 수 없음', async () => {
    const fd = new FormData();
    fd.append('site_name', '<p> </p>');
    const r = await admin.request('POST', '/admin/apply', { body: fd });
    assert.equal(r.status, 400);
    assert.match(r.text, /비워둘 수 없습니다/);
  });
});

describe('마이페이지 프로필', () => {
  it('닉네임 변경은 중복 확인을 거쳐야 함, 아바타 변경', async () => {
    const c = new Client(server.base);
    await c.login('user_one', 'password1');
    const form = () => {
      const fd = new FormData();
      fd.append('nickname', '새닉네임');
      return fd;
    };
    const warn = await c.request('POST', '/mypage/profile', { body: form() });
    assert.equal(warn.status, 400);
    assert.match(warn.text, /닉네임 중복 확인을 해주세요/);

    assert.deepEqual((await c.get('/auth/check-nickname?nickname=' + encodeURIComponent('새닉네임'))).json(), { available: true });
    const fd = form();
    fd.append('avatar', new Blob([FIXTURES.png()], { type: 'image/png' }), 'a.png');
    const ok = await c.request('POST', '/mypage/profile', { body: fd });
    assert.equal(ok.location, '/mypage?saved=1');
    const page = (await c.get('/mypage?saved=1')).text;
    assert.match(page, /value="새닉네임"/);
    assert.match(page, /적용이 완료되었습니다/);
    const av = /src="(\/media\/user\/\d+\/avatar)"/.exec(page)[1];
    assert.equal((await c.get(av)).headers.get('content-type'), 'image/png');
  });

  it('다른 사람의 중복 확인 결과는 쓸 수 없음', async () => {
    const a = new Client(server.base);
    await a.login('user_two', 'password1');
    await a.get('/auth/check-nickname?nickname=' + encodeURIComponent('훔친닉'));
    const b = new Client(server.base);
    await b.login('user_one', 'password1');
    b.cookies.set('portfolio_nickv', a.cookies.get('portfolio_nickv'));
    const fd = new FormData();
    fd.append('nickname', '훔친닉');
    assert.equal((await b.request('POST', '/mypage/profile', { body: fd })).status, 400);
  });
});

describe('목록·글 번호 (윈도 함수)', () => {
  it('메인·전체·게시판 목록의 번호가 전체 기준 순번과 일치', async () => {
    const r = await admin.post('/admin/projects', { name: 'B게시판', name_ja: 'B', description: 'd' });
    assert.equal(r.status, 302);
    const boards = (await admin.get('/mypage/boards')).text;
    const boardB = [...boards.matchAll(/data-board-edit="(\d+)"/g)].map((m) => m[1]).pop();
    for (let i = 1; i <= 6; i += 1) await admin.createPost({ title: `A${i}`, project_id: boardId });
    for (let i = 1; i <= 2; i += 1) await admin.createPost({ title: `B${i}`, project_id: boardB });

    const nums = (html) => [...html.matchAll(/board-td--num">(\d+)/g)].map((m) => Number(m[1]));
    const all = nums((await admin.get('/posts')).text);
    const total = all.length;
    assert.deepEqual(all, Array.from({ length: total }, (_, i) => total - i), '전체 목록은 total..1');

    assert.deepEqual(nums((await admin.get(`/boards/${boardB}`)).text), [total, total - 1], 'B게시판은 가장 최근 두 번호');

    const home = nums((await admin.get('/')).text);
    assert.deepEqual(home.slice(0, 5), [total, total - 1, total - 2, total - 3, total - 4], '메인 최근 5개');
    const boardAOnHome = home.slice(5, 10);
    assert.equal(boardAOnHome.length, 5, '게시판별 최대 5개');
    assert.deepEqual(boardAOnHome, [total - 2, total - 3, total - 4, total - 5, total - 6]);
  });
});

describe('미참조 첨부 정리 (Cron)', () => {
  it('24시간 지난 미참조만 삭제, 참조 중·유예 중·자기소개 참조는 유지', async () => {
    const dir = server.persistDir;
    const old = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-48 hours')";
    d1(
      dir,
      `INSERT INTO post_body_assets (id, r2_key, mime, size, created_at) VALUES
         (7000, 'k/7000', 'image/png', 5, ${old}),
         (70001, 'k/70001', 'image/png', 5, ${old}),
         (7100, 'k/7100', 'image/png', 5, ${old}),
         (7200, 'k/7200', 'image/png', 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours')),
         (7300, 'k/7300', 'image/png', 5, ${old});
       INSERT INTO posts (title, content) VALUES ('ref', '<img src="/media/post-body/7000">');
       INSERT INTO site_settings (key, value) VALUES ('bio', '<p><img src="/media/post-body/7300"></p>')
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    );
    const r = await fetch(server.base + '/__scheduled?cron=17+*/6+*+*+*');
    assert.equal(r.status, 200);
    const left = d1(dir, 'SELECT id FROM post_body_assets WHERE id >= 7000 ORDER BY id').map((x) => x.id);
    assert.deepEqual(left, [7000, 7200, 7300], '70001(N0 경계)·7100은 삭제, 참조 중·유예 중은 유지');
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
