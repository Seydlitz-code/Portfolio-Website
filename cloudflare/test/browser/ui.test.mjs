/**
 * 헤드리스 Chrome 테스트 (기존 test/browser/ui.test.js 이식):
 * JS 오류·CSP 위반 없음, 주요 작성 흐름, 방문자 시간대 표시.
 * Chrome 경로: CHROME_PATH 환경변수, 없으면 OS 기본 설치 경로를 찾는다.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { startServer, Client, FIXTURES, ADMIN } from '../helpers.mjs';

const TZ = 'America/New_York';

function findChrome() {
  return [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].find((p) => p && existsSync(p));
}

let server;
let browser;
let page;
const problems = [];
let current = '';

before(async () => {
  const executablePath = findChrome();
  assert.ok(executablePath, 'Chrome을 찾지 못함 (CHROME_PATH 설정)');
  server = await startServer();

  const admin = new Client(server.base);
  await admin.login();
  await admin.post('/admin/projects', { name: '테스트', name_ja: 'テスト', description: '설명' });
  const img = await admin.uploadBody(FIXTURES.png(), 'image/png', 'a.png');
  await admin.createPost({
    title: '미디어 글',
    project_id: '1',
    content:
      `<p><img src="${img.url}"></p><div class="post-embed post-embed--youtube"><div class="post-embed-yt-frame">` +
      '<iframe loading="lazy" title="YouTube video" src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe></div></div>'
  });

  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--no-first-run'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateTimezone(TZ);
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${current}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    /* favicon 미제공 404, 외부 YouTube·폰트 네트워크 실패는 앱 문제가 아님 */
    if (/Failed to load resource/.test(text)) return;
    problems.push(`[console] ${current}: ${text}`);
  });
  page.on('dialog', (d) => {
    problems.push(`[dialog] ${current}: ${d.message()}`);
    d.accept().catch(() => {});
  });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await server.stop();
});

async function visit(path) {
  current = path;
  const res = await page.goto(server.base + path, { waitUntil: 'networkidle2', timeout: 30000 });
  return res.status();
}

async function submitAndWait(formSelector) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    page.$eval(formSelector, (f) => f.requestSubmit())
  ]);
}

describe('브라우저', () => {
  it('공개 페이지 로드', async () => {
    for (const p of ['/', '/posts', '/boards/1', '/posts/1', '/auth/login', '/auth/register']) {
      assert.equal(await visit(p), 200, p);
    }
  });

  it('YouTube 임베드·첨부 이미지가 CSP에 막히지 않음', async () => {
    await visit('/posts/1');
    const state = await page.evaluate(() => ({
      iframe: Boolean(document.querySelector('.post-content iframe[src*="youtube-nocookie"]')),
      images: [...document.querySelectorAll('.post-content img')].map((i) => i.complete && i.naturalWidth >= 0)
    }));
    assert.equal(state.iframe, true);
    assert.deepEqual(state.images, [true]);
  });

  it(`목록 시간이 방문자 시간대(${TZ})로 표시`, async () => {
    await visit('/posts');
    const t = await page.$eval('time[data-local-time]', (el) => ({ iso: el.getAttribute('datetime'), text: el.textContent }));
    const expected = await page.evaluate((iso) => {
      const d = new Date(iso);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }, t.iso);
    assert.equal(t.text, expected);
  });

  it('회원가입 화면: 중복 확인 버튼이 서버 응답을 표시', async () => {
    await visit('/auth/register');
    await page.type('#username', 'browser_user');
    await page.click('#btnCheckUsername');
    await page.waitForFunction(() => /사용 가능한 아이디/.test(document.getElementById('usernameHint').textContent));
  });

  it('폼 로그인', async () => {
    await visit('/auth/login');
    await page.type('input[name=username]', ADMIN.username);
    await page.type('input[name=password]', ADMIN.password);
    await submitAndWait('form[action="/auth/login"]');
    assert.ok(!page.url().includes('/auth/login'), page.url());
  });

  it('관리자 페이지 로드', async () => {
    for (const p of ['/mypage', '/mypage/posts', '/mypage/main-settings', '/mypage/boards', '/posts/new']) {
      assert.equal(await visit(p), 200, p);
    }
  });

  let postPath;
  it('에디터로 새 글 작성', async () => {
    await visit('/posts/new');
    await page.type('#postTitleKo', '브라우저 테스트 글');
    if (await page.$('#postProjectId')) await page.select('#postProjectId', '1');
    /* 헤드리스에서는 contenteditable에 키 입력 포커스가 잡히지 않아 브라우저 편집 명령으로 입력 */
    await page.evaluate(() => {
      const ed = document.getElementById('postEditorBody');
      ed.focus();
      const r = document.createRange();
      r.selectNodeContents(ed);
      r.collapse(false);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      document.execCommand('insertText', false, '본문 내용입니다');
    });
    await submitAndWait('#postEditorForm');
    postPath = new URL(page.url()).pathname;
    assert.match(postPath, /^\/posts\/\d+$/);
    const body = await page.$eval('.post-content', (el) => el.textContent);
    assert.match(body, /본문 내용입니다/);
  });

  it(`댓글 작성, 댓글 시간이 ${TZ}로 표시`, async () => {
    await page.type('#commentMainTextarea', '브라우저 댓글');
    await submitAndWait('#mainCommentForm');
    const t = await page.$eval('time[data-local-time="comment"]', (el) => ({ iso: el.getAttribute('datetime'), text: el.textContent }));
    const expected = await page.evaluate(
      (iso) => new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
      t.iso
    );
    assert.equal(t.text, expected);
  });

  it('글 수정 저장 (에디터가 기존 본문을 불러옴)', async () => {
    await visit(`${postPath}/edit`);
    const loaded = await page.$eval('#postEditorBody', (el) => el.textContent);
    assert.match(loaded, /본문 내용입니다/);
    await submitAndWait('#postEditorForm');
    assert.equal(new URL(page.url()).pathname, postPath);
  });

  it('알림 패널 로드 (fetch가 CSP에 막히지 않음)', async () => {
    await visit('/posts');
    await page.click('#navNotifyBtn');
    await page.waitForFunction(() => {
      const loading = document.getElementById('navNotifyLoading');
      return loading && loading.classList.contains('is-hidden');
    });
    const empty = await page.$eval('#navNotifyEmpty', (el) => el.textContent);
    assert.doesNotMatch(empty, /불러오지 못했습니다/);
  });

  it('메인 설정 저장 (에디터가 기존 이름을 불러옴)', async () => {
    await visit('/mypage/main-settings');
    const name = await page.$eval('#mypageEditorSn', (el) => el.textContent);
    assert.match(name, /Donghawan Lee/);
    await submitAndWait('#mypageMainSettingsForm');
    assert.match(page.url(), /saved=1/);
  });

  it('게시판 관리: 생성 모달로 게시판 만들기', async () => {
    await visit('/mypage/boards');
    const hit = await page.$eval('.mypage-boards-head-actions button', (b) => {
      b.scrollIntoView({ block: 'center' });
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === b || b.contains(top) ? 'ok' : `가려짐: ${top && top.outerHTML.slice(0, 120)}`;
    });
    assert.equal(hit, 'ok', '생성 버튼이 다른 요소에 가려지지 않아야 함');
    await page.click('.mypage-boards-head-actions button');
    await page.waitForFunction(() => document.getElementById('createBoardModal').style.display === 'flex');
    await page.type('#createBoardNameKo', '브라우저 게시판');
    await page.type('#createBoardNameJa', 'ブラウザ');
    await page.type('#createBoardDesc', '소개');
    await submitAndWait('#createBoardForm');
    assert.match(page.url(), /saved=1/);
    assert.match(await page.content(), /브라우저 게시판/);
  });

  it('로그아웃', async () => {
    await visit('/');
    await submitAndWait('form[action="/auth/logout"]');
    assert.ok(await page.$('a[href="/auth/login"]'));
  });

  it('전체 과정에서 JS 오류·CSP 위반·예상치 못한 alert 없음', () => {
    assert.deepEqual([...new Set(problems)], []);
  });
});
