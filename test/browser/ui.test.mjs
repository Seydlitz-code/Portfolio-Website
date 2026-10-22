/**
 * 헤드리스 Chrome 테스트 (기존 test/browser/ui.test.js 이식):
 * JS 오류·CSP 위반 없음, 주요 작성 흐름, 방문자 시간대 표시.
 * Chrome 경로: CHROME_PATH 환경변수, 없으면 OS 기본 설치 경로를 찾는다.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { startServer, Client, FIXTURES, ADMIN } from '../helpers.mjs';

const TIME_ZONE = 'America/New_York';

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
  ].find((candidate) => candidate && existsSync(candidate));
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
  const uploaded = await admin.uploadBody(FIXTURES.buildPng(), 'image/png');
  await admin.createPost({
    title: '미디어 글',
    project_id: '1',
    content:
      `<p><img src="${uploaded.url}"></p><div class="post-embed post-embed--youtube"><div class="post-embed-yt-frame">` +
      '<iframe loading="lazy" title="YouTube video" src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe></div></div>'
  });

  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--no-first-run'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.emulateTimezone(TIME_ZONE);
  await page.evaluateOnNewDocument(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${current}: ${e.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // favicon 미제공 404, 외부 YouTube·폰트 네트워크 실패는 앱 문제가 아님
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
    for (const urlPath of ['/', '/posts', '/boards/1', '/posts/1', '/auth/login', '/auth/register']) {
      assert.equal(await visit(urlPath), 200, urlPath);
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

  it(`목록 시간이 방문자 시간대(${TIME_ZONE})로 표시`, async () => {
    await visit('/posts');
    const timeElement = await page.$eval('time[data-local-time]', (element) => ({ iso: element.getAttribute('datetime'), text: element.textContent }));
    const expected = await page.evaluate((iso) => {
      const date = new Date(iso);
      const padTwoDigits = (n) => String(n).padStart(2, '0');
      return `${date.getFullYear()}.${padTwoDigits(date.getMonth() + 1)}.${padTwoDigits(date.getDate())} ${padTwoDigits(date.getHours())}:${padTwoDigits(date.getMinutes())}`;
    }, timeElement.iso);
    assert.equal(timeElement.text, expected);
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
    for (const urlPath of ['/mypage', '/mypage/posts', '/mypage/main-settings', '/mypage/boards', '/posts/new']) {
      assert.equal(await visit(urlPath), 200, urlPath);
    }
  });

  let postPath;
  it('에디터로 새 글 작성', async () => {
    await visit('/posts/new');
    await page.type('#postTitleKo', '브라우저 테스트 글');
    if (await page.$('#postProjectId')) await page.select('#postProjectId', '1');
    // 헤드리스에서는 contenteditable에 키 입력 포커스가 잡히지 않아 브라우저 편집 명령으로 입력
    await page.evaluate(() => {
      const editor = document.getElementById('postEditorBody');
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('insertText', false, '본문 내용입니다');
    });
    // 이미지 버튼의 파일 선택 → post-editor.js가 파일 본문을 그대로 올리고 본문에 <img>를 넣는다.
    const imagePath = join(mkdtempSync(join(tmpdir(), 'portfolio-ui-')), 'upload.png');
    writeFileSync(imagePath, FIXTURES.buildPng());
    const fileInput = await page.$('#postEditorFileImage');
    await fileInput.uploadFile(imagePath);
    await page.waitForFunction(() => /\/media\/post-body\/\d+/.test(document.getElementById('postEditorBody').innerHTML), {
      timeout: 15000
    });
    await submitAndWait('#postEditorForm');
    postPath = new URL(page.url()).pathname;
    assert.match(postPath, /^\/posts\/\d+$/);
    const body = await page.$eval('.post-content', (element) => element.textContent);
    assert.match(body, /본문 내용입니다/);
    assert.ok(await page.$('.post-content img[src^="/media/post-body/"]'), '에디터로 올린 이미지가 본문에 있음');
  });

  it(`댓글 작성, 댓글 시간이 ${TIME_ZONE}로 표시`, async () => {
    await page.type('#commentMainTextarea', '브라우저 댓글');
    await submitAndWait('#mainCommentForm');
    const timeElement = await page.$eval('time[data-local-time="comment"]', (element) => ({ iso: element.getAttribute('datetime'), text: element.textContent }));
    const expected = await page.evaluate(
      (iso) => new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
      timeElement.iso
    );
    assert.equal(timeElement.text, expected);
  });

  it('글 수정 저장 (에디터가 기존 본문을 불러옴)', async () => {
    await visit(`${postPath}/edit`);
    const loaded = await page.$eval('#postEditorBody', (element) => element.textContent);
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
    const empty = await page.$eval('#navNotifyEmpty', (element) => element.textContent);
    assert.doesNotMatch(empty, /불러오지 못했습니다/);
  });

  it('메인 설정 저장 (에디터가 기존 이름을 불러옴)', async () => {
    await visit('/mypage/main-settings');
    const name = await page.$eval('#mypageEditorSn', (element) => element.textContent);
    assert.match(name, /Donghawan Lee/);
    await submitAndWait('#mypageMainSettingsForm');
    assert.match(page.url(), /saved=1/);
  });

  it('게시판 관리: 생성 모달로 게시판 만들기', async () => {
    await visit('/mypage/boards');
    const hit = await page.$eval('.mypage-boards-head-actions button', (button) => {
      button.scrollIntoView({ block: 'center' });
      const buttonBox = button.getBoundingClientRect();
      const top = document.elementFromPoint(buttonBox.left + buttonBox.width / 2, buttonBox.top + buttonBox.height / 2);
      return top === button || button.contains(top) ? 'ok' : `가려짐: ${top && top.outerHTML.slice(0, 120)}`;
    });
    assert.equal(hit, 'ok', '생성 버튼이 다른 요소에 가려지지 않아야 함');
    // style.css의 scroll-behavior: smooth 때문에 좌표 클릭은 스크롤 도중 빗나갈 수 있어 요소에 직접 클릭을 보낸다.
    await page.$eval('.mypage-boards-head-actions button', (b) => b.click());
    await page.waitForFunction(() => document.getElementById('createBoardModal').style.display === 'flex');
    // 빈 칸이면 mypage-boards.js가 제출을 막고 안내 문구를 보여야 한다.
    await page.$eval('#createBoardForm', (f) => f.requestSubmit());
    assert.match(await page.$eval('#createBoardFormError', (element) => element.textContent), /작성하지 않아/);
    // Puppeteer의 한글·일본어 키 입력은 글자가 빠지는 등 불안정해서 값은 직접 넣는다.
    await page.evaluate(() => {
      document.getElementById('createBoardNameKo').value = '브라우저 게시판';
      document.getElementById('createBoardNameJa').value = 'ブラウザ';
      document.getElementById('createBoardDesc').value = '소개';
    });
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
