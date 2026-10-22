/**
 * HTTP 통합 테스트: wrangler dev로 Worker를 띄워 기능·보안 동작을 확인한다.
 * 기존 test/integration/app.test.js의 항목을 그대로 옮기고, Workers 버전에서 새로 생긴 동작을 더했다.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, Client, FIXTURES, ADMIN, runD1Sql } from './helpers.mjs';

function formatKstListTime(iso) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
    .formatToParts(new Date(iso))
    .reduce((partsByType, part) => ((partsByType[part.type] = part.value), partsByType), {});
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
}

let server;
let admin;
const BOARD_ID = '1';

before(async () => {
  server = await startServer();
  admin = new Client(server.base);
  await admin.login();
  const res = await admin.post('/admin/projects', { name: '테스트', name_ja: 'テスト', description: '설명' });
  assert.equal(res.status, 302);
});

after(async () => {
  if (server) await server.stop();
});

describe('기본 페이지·ID 검증', () => {
  const createGuestClient = () => new Client(server.base);

  for (const urlPath of ['/', '/posts', '/auth/login', '/auth/register', '/boards/1']) {
    it(`GET ${urlPath} → 200`, async () => {
      assert.equal((await createGuestClient().get(urlPath)).status, 200);
    });
  }

  it('아주 큰 페이지 번호도 500이 아니라 마지막 페이지로 이동', async () => {
    const res = await createGuestClient().get('/posts?page=100000000000000000000');
    assert.equal(res.status, 302);
    assert.match(res.location, /^\/posts(\?page=\d+)?$/);
  });
  for (const urlPath of ['/posts/abc', '/posts/99999999999', '/boards/abc', '/media/post-body/99999999999', '/media/user/abc/avatar', '/nope']) {
    it(`GET ${urlPath} → 404 (500 아님)`, async () => {
      assert.equal((await createGuestClient().get(urlPath)).status, 404);
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
    assert.equal((await createGuestClient().get('/posts/')).status, 200);
    assert.equal((await createGuestClient().get('/boards/1/')).status, 200);
  });

  it('없는 사용자의 아바타 → 404', async () => {
    assert.equal((await createGuestClient().get('/media/user/999999/avatar')).status, 404);
  });

  it('비로그인 /mypage → 로그인으로', async () => {
    const res = await createGuestClient().get('/mypage');
    assert.equal(res.status, 302);
    assert.match(res.location, /^\/auth\/login/);
  });

  it('모든 화면에 DOCTYPE', async () => {
    for (const urlPath of ['/', '/posts', '/boards/1', '/auth/login', '/nope']) {
      assert.match((await createGuestClient().get(urlPath)).text, /^<!DOCTYPE html>/, urlPath);
    }
  });
});

describe('보안 헤더', () => {
  it('CSP·nosniff·X-Frame-Options 설정, X-Powered-By 없음', async () => {
    const res = await new Client(server.base).get('/');
    assert.match(res.headers.get('content-security-policy') || '', /object-src 'none'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('링크로만 접속: 페이지·오류·헬스체크·정적 파일 모두 검색 제외 표시', async () => {
    const client = new Client(server.base);
    for (const urlPath of ['/', '/posts', '/auth/login', '/nope', '/healthz', '/css/style.css', '/robots.txt']) {
      const res = await client.get(urlPath);
      assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive', urlPath);
    }
    assert.match((await client.get('/')).text, /<meta name="robots" content="noindex, nofollow, noarchive"\/?>/);
    assert.match((await client.get('/robots.txt')).text, /^Disallow: \/$/m);
  });
});

describe('세션', () => {
  it('로그인마다 새 세션, 로그아웃한 세션은 무효', async () => {
    const client = new Client(server.base);
    await client.login();
    const first = client.cookies.get('portfolio_sid');
    assert.ok(first);
    assert.equal((await client.get('/mypage/main-settings')).status, 200);
    await client.post('/auth/logout', {});
    const stale = new Client(server.base);
    stale.cookies.set('portfolio_sid', first);
    assert.equal((await stale.get('/mypage/main-settings')).status, 302, '로그아웃한 세션은 비로그인 취급');

    const again = new Client(server.base);
    await again.login();
    assert.notEqual(again.cookies.get('portfolio_sid'), first);
  });

  it('삭제된 계정의 세션은 로그인 화면으로', async () => {
    const client = new Client(server.base);
    assert.equal((await client.register({ nickname: 'ghost', username: 'ghost_user' })).status, 302);
    await client.login('ghost_user', 'password1');
    runD1Sql(server.persistDir, "DELETE FROM users WHERE username = 'ghost_user'");
    const res = await client.get('/mypage');
    assert.equal(res.status, 302);
    assert.match(res.location, /^\/auth\/login/);
  });
});

describe('오픈 리다이렉트', () => {
  for (const [next, want] of [
    ['/%5Cevil.com', '/'],
    ['//evil.com', '/'],
    ['/posts', '/posts']
  ]) {
    it(`next=${decodeURIComponent(next)} → ${want}`, async () => {
      const res = await admin.get(`/auth/login?next=${next}`);
      assert.equal(res.status, 302);
      assert.equal(res.location, want);
    });
  }
});

describe('CSRF: 교차 출처 상태 변경 차단', () => {
  const form = { name: 'x', name_ja: 'x', description: 'x' };
  it('외부 Origin → 403', async () => {
    assert.equal((await admin.post('/admin/projects', form, { origin: 'https://evil.com' })).status, 403);
  });
  it('외부 Referer(Origin 없음) → 403', async () => {
    const res = await admin.request('POST', '/admin/projects', { form, origin: false, headers: { Referer: 'https://evil.com/x' } });
    assert.equal(res.status, 403);
  });
  it('Origin: null → 403', async () => {
    assert.equal((await admin.post('/admin/projects', form, { headers: { Origin: 'null' } })).status, 403);
  });
  it('12MB를 넘는 텍스트 폼은 본문을 읽기 전에 413', async () => {
    const res = await admin.request('POST', '/posts', {
      body: 'content=' + 'a'.repeat(12 * 1024 * 1024 + 1),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    assert.equal(res.status, 413);
  });
  it('Content-Type 대소문자를 바꿔도 12MB 제한', async () => {
    const res = await admin.request('POST', '/posts', {
      body: 'content=' + 'a'.repeat(12 * 1024 * 1024 + 1),
      headers: { 'Content-Type': 'Application/X-WWW-Form-Urlencoded' }
    });
    assert.equal(res.status, 413);
  });
  it('Content-Length 없는(chunked) 본문도 12MB를 넘으면 413', async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(97);
    let sent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (sent >= 13) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      }
    });
    const res = await fetch(server.base + '/posts', {
      method: 'POST',
      body: stream,
      duplex: 'half',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: server.base, Cookie: admin.buildCookieHeader() },
      redirect: 'manual'
    });
    assert.equal(res.status, 413);
  });
  it('로그인 폼은 multipart라도 64KB를 넘으면 413', async () => {
    const formData = new FormData();
    formData.append('username', 'a'.repeat(70 * 1024));
    formData.append('password', 'x');
    const res = await new Client(server.base).request('POST', '/auth/login', { body: formData });
    assert.equal(res.status, 413);
  });
  it('업로드 경로라도 첨부 형식이 아닌 12MB 초과 본문은 413 (로그인 전에 막음)', async () => {
    const res = await new Client(server.base).request('POST', '/posts/body-upload', {
      body: 'a=' + 'a'.repeat(12 * 1024 * 1024 + 1),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    assert.equal(res.status, 413);
  });
  it('로그인 폼은 Content-Length 없는(chunked) 본문도 64KB를 넘으면 413', async () => {
    const chunk = new Uint8Array(16 * 1024).fill(97);
    let sent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (sent >= 8) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      }
    });
    const res = await fetch(server.base + '/auth/login', {
      method: 'POST',
      body: stream,
      duplex: 'half',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: server.base },
      redirect: 'manual'
    });
    assert.equal(res.status, 413);
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
    const id = await admin.createPost({ title: 'xss', content: payload, project_id: BOARD_ID });
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
    for (const vector of vectors) {
      const id = await admin.createPost({ title: 'vec', content: `<p>본문</p>${vector}`, project_id: BOARD_ID });
      const page = (await new Client(server.base).get(`/posts/${id}`)).text;
      const body = page.slice(page.indexOf('class="post-content'), page.indexOf('id="comments"'));
      assert.doesNotMatch(body, /<img[^>]*onerror/i, vector);
      assert.doesNotMatch(body, /evil\.example/, vector);
      // 저장된 원문도 안전해야 한다 (에디터가 innerHTML로 다시 넣음)
      const edit = (await admin.get(`/posts/${id}/edit`)).text;
      const init = JSON.parse(Buffer.from(/id="post-editor-init-b64" value="([^"]+)"/.exec(edit)[1], 'base64').toString('utf8'));
      assert.doesNotMatch(init.html, /<img[^>]*onerror/i, vector);
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
    id = await admin.createPost({ title: '조회수', project_id: BOARD_ID });
  });

  it('같은 방문자의 반복 조회는 1회만 집계', async () => {
    const guest = new Client(server.base);
    const counts = [];
    for (let i = 0; i < 3; i += 1) counts.push(/조회 (\d+)/.exec((await guest.get(`/posts/${id}`)).text)[1]);
    assert.deepEqual(counts, ['1', '1', '1']);
  });

  it('datetime은 ISO UTC, 서버 기본 표시는 한국 시간', async () => {
    const html = (await new Client(server.base).get(`/posts/${id}`)).text;
    const timeMatch = /datetime="([^"]+)" data-local-time="list">([^<]+)</.exec(html);
    assert.ok(timeMatch, 'time 요소');
    assert.match(timeMatch[1], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    assert.ok(Math.abs(Date.now() - new Date(timeMatch[1]).getTime()) < 5 * 60 * 1000, 'ISO 시각이 현재와 일치');
    assert.equal(timeMatch[2], formatKstListTime(timeMatch[1]));
  });
});

describe('본문 첨부: 형식 검증·Range·정리', () => {
  const mp4 = FIXTURES.buildMp4();
  let url;

  it('내용이 미디어가 아니면 거부 (MIME만 속인 파일)', async () => {
    assert.equal((await admin.uploadBody(FIXTURES.buildJunk(), 'video/mp4')).status, 400);
  });

  it('허용하지 않는 형식(Content-Type) 거부', async () => {
    assert.equal((await admin.uploadBody(mp4, 'text/plain')).status, 400);
  });

  it('일반 회원은 업로드 불가', async () => {
    const member = new Client(server.base);
    assert.equal((await member.uploadBody(mp4, 'video/mp4')).status, 403);
  });

  it('mp4 시그니처 파일 업로드', async () => {
    const res = await admin.uploadBody(mp4, 'video/mp4');
    assert.equal(res.status, 200);
    assert.match(res.url, /^\/media\/post-body\/\d+$/);
    url = res.url;
  });

  it('Range bytes=0-1 → 206 + Content-Range', async () => {
    const res = await new Client(server.base).get(url, { headers: { Range: 'bytes=0-1' } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes 0-1/${mp4.length}`);
    assert.ok(res.buffer.equals(mp4.subarray(0, 2)));
  });

  it('중간·끝(suffix) 범위 내용 일치', async () => {
    const guest = new Client(server.base);
    const middleRes = await guest.get(url, { headers: { Range: 'bytes=1000-200999' } });
    assert.ok(middleRes.buffer.equals(mp4.subarray(1000, 201000)));
    const tail = await guest.get(url, { headers: { Range: 'bytes=-500' } });
    assert.ok(tail.buffer.equals(mp4.subarray(mp4.length - 500)));
  });

  it('범위 밖 → 416, Range 없음 → 전체', async () => {
    const guest = new Client(server.base);
    assert.equal((await guest.get(url, { headers: { Range: 'bytes=99999999-' } })).status, 416);
    const full = await guest.get(url);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.ok(full.buffer.equals(mp4));
  });

  it('수정으로 본문에서 빠진 첨부는 삭제', async () => {
    const id = await admin.createPost({ title: 'media', content: `<p><video src="${url}" controls></video></p>`, project_id: BOARD_ID });
    const res = await admin.post(`/posts/${id}?_method=PUT`, { title: 'media', content: '<p>텍스트만</p>', project_id: BOARD_ID });
    assert.equal(res.status, 302);
    assert.equal((await new Client(server.base).get(url)).status, 404);
  });

  it('D1 저장 상한(약 2MB)을 넘는 본문은 안내와 함께 다시 그림', async () => {
    const res = await admin.post('/posts', { title: 'big', content: `<p>${'a'.repeat(2_100_000)}</p>`, project_id: BOARD_ID });
    assert.equal(res.status, 200);
    assert.match(res.text, /본문이 너무 큽니다/);
    const editorInitBase64 = /id="post-editor-init-b64" value="([^"]+)"/.exec(res.text)[1];
    assert.equal(JSON.parse(Buffer.from(editorInitBase64, 'base64').toString('utf8')).html, '', '저장할 수 없는 본문은 되돌려 보내지 않음');
  });

  it('게시물 삭제 시 첨부도 삭제', async () => {
    const up = await admin.uploadBody(mp4, 'video/mp4');
    const id = await admin.createPost({ title: 'media2', content: `<p><video src="${up.url}"></video></p>`, project_id: BOARD_ID });
    assert.equal((await new Client(server.base).get(up.url)).status, 200);
    assert.equal((await admin.post(`/posts/${id}?_method=DELETE`, {})).status, 302);
    assert.equal((await new Client(server.base).get(up.url)).status, 404);
  });
});

describe('게시물 작성·수정 검증', () => {
  let id;
  before(async () => {
    id = await admin.createPost({ title: '수정대상', project_id: BOARD_ID });
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
    const empty = await admin.post('/posts', { title: 't', content: '<p> </p>', project_id: BOARD_ID });
    assert.match(empty.text, /국문 제목과 본문/);
  });
  it('수정 폼에 기존 제목과 에디터 초기값', async () => {
    const res = await admin.get(`/posts/${id}/edit`);
    assert.equal(res.status, 200);
    const editorInitBase64 = /id="post-editor-init-b64" value="([^"]+)"/.exec(res.text)[1];
    const init = JSON.parse(Buffer.from(editorInitBase64, 'base64').toString('utf8'));
    assert.equal(init.titleKo, 't');
    assert.equal(init.html, 'hello');
  });
  it('게시판에서 새 글: 게시판 고정', async () => {
    const res = await admin.get(`/posts/new?project_id=${BOARD_ID}&cancel=%2Fboards%2F${BOARD_ID}`);
    assert.match(res.text, /name="_project_form_locked" value="1"/);
    assert.match(res.text, new RegExp(`name="_cancel_href" value="/boards/${BOARD_ID}"`));
  });
});

describe('회원가입', () => {
  it('정상 가입 → 로그인 화면', async () => {
    const res = await new Client(server.base).register({ nickname: 'nick1', username: 'user_one' });
    assert.equal(res.status, 302);
    assert.equal(res.location, '/auth/login?registered=true');
  });

  it('같은 보안 문자 정답 재사용 거부', async () => {
    const client = new Client(server.base);
    const captcha = await client.readCaptchaAnswer();
    const base = { password: 'password1', passwordConfirm: 'password1', captcha };
    assert.equal((await client.post('/auth/register', { ...base, nickname: 'nick2', username: 'user_two' })).status, 302);
    const again = await client.post('/auth/register', { ...base, nickname: 'nick3', username: 'user_three' });
    assert.equal(again.status, 200, '오류 화면 재표시');
    assert.match(again.text, /보안 문자/);
  });

  it('아이디 31자 이상 거부', async () => {
    const res = await new Client(server.base).register({ nickname: 'longid', username: 'u'.repeat(31) });
    assert.equal(res.status, 200);
  });

  it('닉네임 21자 이상 거부', async () => {
    const res = await new Client(server.base).register({ nickname: 'n'.repeat(21), username: 'user_four' });
    assert.equal(res.status, 200);
  });

  it('내용이 이미지가 아닌 아바타 거부', async () => {
    const client = new Client(server.base);
    const captcha = await client.readCaptchaAnswer();
    const formData = new FormData();
    for (const [name, value] of Object.entries({ nickname: 'nick5', username: 'user_five', password: 'password1', passwordConfirm: 'password1', captcha })) {
      formData.append(name, String(value));
    }
    formData.append('avatar', new Blob([FIXTURES.buildJunk()], { type: 'image/png' }), 'fake.png');
    const res = await client.request('POST', '/auth/register', { body: formData });
    assert.equal(res.status, 200);
    assert.match(res.text, /JPG, PNG, GIF, WEBP/);
  });
});

describe('권한·댓글·알림', () => {
  let user;
  let postId;
  before(async () => {
    user = new Client(server.base);
    await user.login('user_one', 'password1');
    postId = await admin.createPost({ title: '댓글대상', project_id: BOARD_ID });
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
    const res = await admin.get('/api/notifications', { headers: { Accept: 'application/json' } });
    const data = res.json();
    assert.ok(data.unreadCount >= 1);
    const item = data.items.find((x) => x.postId === postId);
    assert.ok(item, '해당 게시물 알림');
    assert.equal(item.excerpt, '안녕하세요 댓글');
    assert.match(item.createdAt, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    assert.equal(item.unread, true);
  });

  it('알림 썸네일은 게시물 본문의 첫 이미지', async () => {
    const thumbPostId = await admin.createPost({
      title: 'thumb',
      content: `<p>${'긴 본문 '.repeat(500)}</p><p><img src="/images/default-profile.svg"></p>`,
      project_id: BOARD_ID
    });
    assert.equal((await user.post(`/posts/${thumbPostId}/comments`, { content: '썸네일 확인' })).status, 302);
    const data = (await admin.get('/api/notifications', { headers: { Accept: 'application/json' } })).json();
    const item = data.items.find((entry) => entry.postId === thumbPostId);
    assert.equal(item.thumbUrl, '/images/default-profile.svg');
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
    const commentId = /id="comment-view-(\d+)"/.exec(html)[1];
    assert.equal((await admin.post(`/posts/${postId}/comments/${commentId}?_method=PUT`, { content: '남의 댓글' })).status, 403);
    assert.equal((await user.post(`/posts/${postId}/comments/${commentId}?_method=PUT`, { content: '고친 댓글' })).status, 302);
    assert.match((await user.get(`/posts/${postId}`)).text, /고친 댓글/);
    assert.equal((await admin.post(`/posts/${postId}/comments/${commentId}?_method=DELETE`, {})).status, 302);
    assert.doesNotMatch((await user.get(`/posts/${postId}`)).text, /고친 댓글/);
  });

  it('마이페이지 작성한 글: 댓글 목록과 삭제 후 next로 복귀', async () => {
    await user.post(`/posts/${postId}/comments`, { content: '마이페이지에서 지울 댓글' });
    const page = await user.get('/mypage/posts');
    assert.equal(page.status, 200);
    assert.match(page.text, /마이페이지에서 지울 댓글/);
    const actionMatch = /action="\/posts\/(\d+)\/comments\/(\d+)\?_method=DELETE"/.exec(page.text);
    const res = await user.post(`/posts/${actionMatch[1]}/comments/${actionMatch[2]}?_method=DELETE`, { next: '/mypage/posts' });
    assert.equal(res.location, '/mypage/posts');
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
    const deleteRes = await admin.post(`/admin/projects/${id}`, { _method: 'DELETE' });
    assert.equal(deleteRes.location, '/mypage/boards?deleted=1');
    assert.equal((await admin.get(`/boards/${id}`)).status, 404);
  });

  it('글이 있는 게시판은 삭제 불가', async () => {
    const res = await admin.post(`/admin/projects/${BOARD_ID}`, { _method: 'DELETE' });
    assert.equal(res.location, '/mypage/boards?deleteBlocked=1');
  });

  it('메인 페이지 설정: 이름·자기소개 정제, 프로필 이미지 저장', async () => {
    const formData = new FormData();
    formData.append('site_name', '<b>새 이름</b><script>x()</script>');
    formData.append('bio', '<p>소개</p><div><br></div><img src=x onerror=alert(1)>');
    formData.append('profile_image', new Blob([FIXTURES.buildPng()], { type: 'image/png' }), 'p.png');
    const res = await admin.request('POST', '/admin/apply', { body: formData });
    assert.equal(res.location, '/mypage/main-settings?saved=1');
    const home = (await new Client(server.base).get('/')).text;
    assert.match(home, /<h1 class="hero-name"><b>새 이름<\/b><\/h1>/);
    assert.match(home, /<title>새 이름<\/title>/);
    assert.doesNotMatch(home, /onerror/);
    assert.match(home, /src="\/media\/site\/profile-image"/);
    const profileImage = await new Client(server.base).get('/media/site/profile-image');
    assert.equal(profileImage.status, 200);
    assert.equal(profileImage.headers.get('content-type'), 'image/png');
    const etag = profileImage.headers.get('etag');
    assert.ok(etag, 'ETag 필요');
    const again = await new Client(server.base).get('/media/site/profile-image', { headers: { 'If-None-Match': etag } });
    assert.equal(again.status, 304, '바뀌지 않았으면 304');
    assert.equal(again.buffer.length, 0);
  });

  it('자기소개에서 빠진 본문 첨부는 저장할 때 삭제', async () => {
    runD1Sql(server.persistDir, "INSERT INTO post_body_assets (id, r2_key, mime, size) VALUES (7600, 'k/7600', 'image/png', 5)");
    const countAsset = () => runD1Sql(server.persistDir, 'SELECT COUNT(*) AS count FROM post_body_assets WHERE id = 7600')[0].count;
    const saveBio = (bio) => {
      const formData = new FormData();
      formData.append('bio', bio);
      return admin.request('POST', '/admin/apply', { body: formData });
    };
    assert.equal((await saveBio('<p><img src="/media/post-body/7600"></p>')).location, '/mypage/main-settings?saved=1');
    assert.equal(countAsset(), 1, '참조 중에는 유지');
    assert.equal((await saveBio('<p>이미지 없는 소개</p>')).location, '/mypage/main-settings?saved=1');
    assert.equal(countAsset(), 0, '자기소개에서 빠지면 삭제');
  });

  it('자기소개가 6만 자를 넘으면 안내 (메인 화면 정제 캐시에 담을 수 있는 길이)', async () => {
    const formData = new FormData();
    formData.append('bio', `<p>${'가'.repeat(70 * 1024)}</p>`);
    const res = await admin.request('POST', '/admin/apply', { body: formData });
    assert.equal(res.status, 400);
    assert.match(res.text, /내용이 너무 깁니다/);
  });

  it('자기소개 빈 블록 정리는 긴 공백에서도 바로 끝남 (정규식 되추적 방지)', async () => {
    const formData = new FormData();
    formData.append('bio', `<div>${' '.repeat(20000)}<b>내용</b></div><div> <br> </div>`);
    const startedAt = Date.now();
    const res = await admin.request('POST', '/admin/apply', { body: formData });
    assert.equal(res.location, '/mypage/main-settings?saved=1');
    assert.ok(Date.now() - startedAt < 3000, '저장이 3초 안에 끝나야 함');
    const home = (await new Client(server.base).get('/')).text;
    assert.match(home, /<b>내용<\/b>/);
    assert.doesNotMatch(home, /<div> <br> <\/div>/, '빈 블록은 지움');
  });

  it('메인 페이지 이름은 비울 수 없음', async () => {
    const formData = new FormData();
    formData.append('site_name', '<p> </p>');
    const res = await admin.request('POST', '/admin/apply', { body: formData });
    assert.equal(res.status, 400);
    assert.match(res.text, /비워둘 수 없습니다/);
  });
});

describe('마이페이지 프로필', () => {
  it('닉네임 변경은 중복 확인을 거쳐야 함, 아바타 변경', async () => {
    const client = new Client(server.base);
    await client.login('user_one', 'password1');
    const buildNicknameForm = () => {
      const formData = new FormData();
      formData.append('nickname', '새닉네임');
      return formData;
    };
    const warn = await client.request('POST', '/mypage/profile', { body: buildNicknameForm() });
    assert.equal(warn.status, 400);
    assert.match(warn.text, /닉네임 중복 확인을 해주세요/);

    assert.deepEqual((await client.get('/auth/check-nickname?nickname=' + encodeURIComponent('새닉네임'))).json(), { available: true });
    const formData = buildNicknameForm();
    formData.append('avatar', new Blob([FIXTURES.buildPng()], { type: 'image/png' }), 'a.png');
    const ok = await client.request('POST', '/mypage/profile', { body: formData });
    assert.equal(ok.location, '/mypage?saved=1');
    const page = (await client.get('/mypage?saved=1')).text;
    assert.match(page, /value="새닉네임"/);
    assert.match(page, /적용이 완료되었습니다/);
    const avatarUrl = /src="(\/media\/user\/\d+\/avatar)"/.exec(page)[1];
    const first = await client.get(avatarUrl);
    assert.equal(first.headers.get('content-type'), 'image/png');
    assert.equal((await client.get(avatarUrl, { headers: { 'If-None-Match': first.headers.get('etag') } })).status, 304);
  });

  it('다른 사람의 중복 확인 결과는 쓸 수 없음', async () => {
    const owner = new Client(server.base);
    await owner.login('user_two', 'password1');
    await owner.get('/auth/check-nickname?nickname=' + encodeURIComponent('훔친닉'));
    const thief = new Client(server.base);
    await thief.login('user_one', 'password1');
    thief.cookies.set('portfolio_nickv', owner.cookies.get('portfolio_nickv'));
    const formData = new FormData();
    formData.append('nickname', '훔친닉');
    assert.equal((await thief.request('POST', '/mypage/profile', { body: formData })).status, 400);
  });
});

describe('목록·글 번호 (윈도 함수)', () => {
  it('메인·전체·게시판 목록의 번호가 전체 기준 순번과 일치', async () => {
    const res = await admin.post('/admin/projects', { name: 'B게시판', name_ja: 'B', description: 'd' });
    assert.equal(res.status, 302);
    const boards = (await admin.get('/mypage/boards')).text;
    const boardB = [...boards.matchAll(/data-board-edit="(\d+)"/g)].map((m) => m[1]).pop();
    for (let i = 1; i <= 6; i += 1) await admin.createPost({ title: `A${i}`, project_id: BOARD_ID });
    for (let i = 1; i <= 2; i += 1) await admin.createPost({ title: `B${i}`, project_id: boardB });

    const readRowNumbers = (html) => [...html.matchAll(/board-td--num">(\d+)/g)].map((m) => Number(m[1]));
    const all = readRowNumbers((await admin.get('/posts')).text);
    const total = all.length;
    assert.deepEqual(all, Array.from({ length: total }, (_, i) => total - i), '전체 목록은 total..1');

    assert.deepEqual(readRowNumbers((await admin.get(`/boards/${boardB}`)).text), [total, total - 1], 'B게시판은 가장 최근 두 번호');

    const home = readRowNumbers((await admin.get('/')).text);
    assert.deepEqual(home.slice(0, 5), [total, total - 1, total - 2, total - 3, total - 4], '메인 최근 5개');
    const boardAOnHome = home.slice(5, 10);
    assert.equal(boardAOnHome.length, 5, '게시판별 최대 5개');
    assert.deepEqual(boardAOnHome, [total - 2, total - 3, total - 4, total - 5, total - 6]);
  });
});

describe('미참조 첨부 정리 (Cron)', () => {
  it('24시간 지난 미참조만 삭제, 참조 중·유예 중·설정 참조는 유지 (id 앞뒤 자리 경계 포함)', async () => {
    const persistDir = server.persistDir;
    const old = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-48 hours')";
    runD1Sql(
      persistDir,
      `INSERT INTO post_body_assets (id, r2_key, mime, size, created_at) VALUES
         (700, 'k/700', 'image/png', 5, ${old}),
         (7000, 'k/7000', 'image/png', 5, ${old}),
         (70001, 'k/70001', 'image/png', 5, ${old}),
         (7100, 'k/7100', 'image/png', 5, ${old}),
         (7200, 'k/7200', 'image/png', 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours')),
         (7300, 'k/7300', 'image/png', 5, ${old}),
         (7400, 'k/7400', 'image/png', 5, ${old});
       INSERT INTO posts (title, content) VALUES ('ref', '<img src="/media/post-body/7000">');
       INSERT INTO site_settings (key, value) VALUES ('bio', '<p><img src="/media/post-body/7300"></p>')
         ON CONFLICT (key) DO UPDATE SET value = excluded.value;
       INSERT INTO site_settings (key, value) VALUES ('test_ref_tail', '끝 /media/post-body/7400')
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`
    );
    const res = await fetch(server.base + '/__scheduled?cron=17+*/6+*+*+*');
    assert.equal(res.status, 200);
    const left = runD1Sql(persistDir, 'SELECT id FROM post_body_assets WHERE id IN (700, 7000, 70001, 7100, 7200, 7300, 7400) ORDER BY id')
      .map((row) => row.id);
    // 700은 7000의 앞자리, 70001은 7000 뒤에 숫자가 더 붙은 id라 참조로 보면 안 된다. 7400은 문자열 끝에서 참조된다.
    assert.deepEqual(left, [7000, 7200, 7300, 7400], '700·70001·7100은 삭제, 참조 중·유예 중은 유지');
    runD1Sql(persistDir, "DELETE FROM site_settings WHERE key = 'test_ref_tail'");
  });

  it('붙지 않은 오래된 첨부 150개를 쿼리 하나로 정리, 한 번 붙은 첨부는 Cron이 검사하지 않음', async () => {
    const persistDir = server.persistDir;
    runD1Sql(
      persistDir,
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 150)
       INSERT INTO post_body_assets (id, r2_key, mime, size, created_at)
       SELECT 80000 + n, 'bulk/' || n, 'image/png', 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-48 hours') FROM seq;
       INSERT INTO post_body_assets (id, r2_key, mime, size, created_at, attached_at)
       VALUES (7500, 'k/7500', 'image/png', 5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-48 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
    );
    assert.equal(runD1Sql(persistDir, 'SELECT COUNT(*) AS count FROM post_body_assets WHERE id > 80000')[0].count, 150);
    assert.equal((await fetch(server.base + '/__scheduled?cron=17+*/6+*+*+*')).status, 200);
    assert.equal(runD1Sql(persistDir, 'SELECT COUNT(*) AS count FROM post_body_assets WHERE id > 80000')[0].count, 0);
    assert.equal(runD1Sql(persistDir, 'SELECT COUNT(*) AS count FROM post_body_assets WHERE id = 7500')[0].count, 1, '붙은 첨부는 유지');
    runD1Sql(persistDir, 'DELETE FROM post_body_assets WHERE id = 7500');
  });

  it('첨부 150개를 참조하는 글: 저장하면 붙음 표시, 삭제하면 바인딩 상한(100개)을 넘어도 모두 삭제', async () => {
    const persistDir = server.persistDir;
    runD1Sql(
      persistDir,
      `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 150)
       INSERT INTO post_body_assets (id, r2_key, mime, size)
       SELECT 90000 + n, 'many/' || n, 'image/png', 5 FROM seq`
    );
    const images = Array.from({ length: 150 }, (_, index) => `<img src="/media/post-body/${90001 + index}">`).join('');
    const id = await admin.createPost({ title: 'many', content: `<p>${images}</p>`, project_id: BOARD_ID });
    const countAttached = () =>
      runD1Sql(persistDir, 'SELECT COUNT(*) AS count FROM post_body_assets WHERE id > 90000 AND attached_at IS NOT NULL')[0].count;
    assert.equal(countAttached(), 150);
    assert.equal((await admin.post(`/posts/${id}?_method=DELETE`, {})).status, 302);
    assert.equal(runD1Sql(persistDir, 'SELECT COUNT(*) AS count FROM post_body_assets WHERE id > 90000')[0].count, 0);
  });
});

describe('로그인 시도 제한 (마지막에 실행: 관리자 계정이 15분 잠김)', () => {
  it('8회 실패 후 429, 올바른 비밀번호도 차단', async () => {
    const client = new Client(server.base);
    let last;
    for (let i = 0; i < 9; i += 1) last = await client.post('/auth/login', { username: ADMIN.username, password: `wrong${i}` });
    assert.equal(last.status, 429);
    assert.equal((await client.post('/auth/login', ADMIN)).status, 429);
  });
});
