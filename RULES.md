# 프로젝트 필수 규칙

이 저장소의 모든 코드와 문서가 지켜야 하는 규칙이다. 규칙을 바꿀 때는 이 문서를 먼저 고치고, 같은 날짜의 `UPDATES.md`에 이유를 적는다.

- 대상: Cloudflare Workers(무료 플랜)에서 돌아가는 포트폴리오 웹사이트
- 스택: Hono + JSX(서버 렌더링), D1(SQLite), R2(파일), TypeScript strict

---

## 1. 폴더 구조와 파일 이름

| 위치 | 내용 | 파일 이름 |
|---|---|---|
| `src/index.tsx` | 앱 조립: 미들웨어 순서, 라우트 연결, 오류 처리, Cron | — |
| `src/routes/` | URL 묶음별 라우트. 파일 이름은 URL 첫 경로와 같게 (`/posts` → `posts.tsx`) | 소문자 |
| `src/views/` | 화면(JSX). 화면 단위로 나눈다 | 소문자 |
| `src/lib/` | 라우트에서 함께 쓰는 로직 | camelCase (`siteData.ts`) |
| `src/types.ts` | 바인딩(`Env`)과 요청 변수(`AppEnv`) 타입 | — |
| `migrations/` | D1 스키마. `0001_설명.sql`처럼 번호 순서 | 번호_snake_case |
| `public/` | 정적 파일. 빌드 없이 그대로 배포되는 브라우저 스크립트·CSS·이미지 | kebab-case |
| `scripts/` | 사람이 직접 실행하는 Node 스크립트 (`.mjs`) | kebab-case |
| `test/` | 통합 테스트(`*.test.mjs`), 브라우저 테스트(`test/browser/`) | — |

- JSX를 쓰는 파일만 `.tsx`, 나머지는 `.ts`다.
- 한 파일이 두 가지 일을 하기 시작하면 `lib/`로 나눈다. 라우트 파일에 SQL 외의 재사용 로직을 쌓지 않는다.

## 2. 주석 작성 방식

**언어와 말투**
- 주석은 **한국어**로, 짧고 쉬운 문장으로 쓴다.
- 코드가 **무엇을** 하는지보다 **왜** 그렇게 하는지를 적는다. 코드만 봐도 알 수 있는 내용은 적지 않는다.

**어디에 무엇을 쓰는가**
- 모든 소스 파일 맨 위에 `/** … */`로 파일의 역할을 한두 줄 적는다. 다른 파일에서 옮겨 온 코드면 출처도 적는다 (예: `(기존 lib/postHtml.js 이식)`).
- 다른 파일에서 쓰는 함수(`export`)는, 이름만으로 동작이 분명하지 않으면 바로 위에 `/** … */`로 동작·반환값·주의점을 적는다.
- 함수 안의 설명은 `//` 한 줄 주석으로 쓴다. 여러 줄 설명이 필요하면 함수 위 `/** */`로 옮긴다.
- 숫자 상수에는 단위와 근거를 적는다 (예: `// 7일`, `// Workers의 PBKDF2 반복 상한`).
- 보안·외부 제약 때문에 일부러 돌아가는 코드에는 반드시 이유를 적는다 (예: CSRF 방어, CPU 한도, 브라우저 버그).

**쓰지 않는 것**
- 주석 처리한 코드 덩어리를 남기지 않는다. 지운 코드는 git 기록에 있다.
- 작업 메모·혼잣말(`// 일단 이렇게`, `// 나중에 고침`)을 남기지 않는다. 할 일은 이슈나 `UPDATES.md`의 "남은 일"에 적는다.
- 비밀번호, 토큰, 계정 정보, 내부 주소를 주석에 적지 않는다.

## 3. 이름 규칙

| 종류 | 규칙 | 예 |
|---|---|---|
| 변수·함수 | camelCase, 함수는 동사로 시작 | `loadSessionUser`, `postId` |
| 불리언 | `is`·`has`·`can`·`should`로 시작 | `isAdmin`, `hasFile` |
| 모듈 상수(바뀌지 않는 값) | UPPER_SNAKE_CASE | `SESSION_TTL_MS`, `ALL_POSTS_PAGE_SIZE` |
| 타입·JSX 컴포넌트 | PascalCase | `SessionUser`, `PostPage` |
| DB 컬럼·DB 행 객체의 필드 | snake_case (SQL과 같게) | `author_id`, `created_at` |
| 시간 상수 | 단위를 이름 끝에 | `_MS`, `_SEC`, `_BYTES` |

- 한 글자 이름은 몇 줄짜리 콜백(`(p) => p.id`), 반복 변수(`i`), Hono 컨텍스트(`c`), 오류(`err`)에만 쓴다. 함수 밖으로 나가거나 여러 줄에 걸쳐 쓰이는 값에는 뜻이 드러나는 이름을 쓴다.
- 줄임말은 널리 쓰이는 것만 쓴다 (`id`, `url`, `db`, `env`, `ip`, `mime`, `res`(응답·쿼리 결과, 예: `listRes`), `args`(명령줄 인자), `props`(JSX 컴포넌트 인자)). 새 줄임말을 만들지 않는다.
- 화면에 보이는 문구(오류 메시지 등)는 한국어로 쓰고, 기존 화면의 문구를 바꿀 때는 테스트도 같이 고친다.

## 4. TypeScript

- `strict`를 끄지 않는다. `any`와 `@ts-ignore`를 쓰지 않는다. 꼭 필요하면 `unknown`으로 받고 좁힌다.
- D1 결과는 `.first<T>()`, `.all<T>()`로 행 타입을 지정한다.
- `npm run typecheck`가 통과해야 커밋한다.

## 5. Cloudflare Workers 규칙

**실행 환경**
- Node 전용 API(`fs`, `child_process`, `process.env` 등)를 `src/`에서 쓰지 않는다. 설정은 `c.env`의 바인딩과 비밀값으로만 받는다.
- 비밀값은 `wrangler secret put`(배포)·`.dev.vars`(로컬)로만 넣는다. 코드·설정 파일·git에 넣지 않는다.
- 요청이 끝난 뒤에도 남는 타이머(`setInterval`, `setTimeout`)를 쓰지 않는다. 주기 작업은 Cron(`scheduled`)으로 한다.
- 응답과 상관없는 마무리 작업(교체된 R2 파일 삭제 등)은 `c.executionCtx.waitUntil()`로 응답 뒤에 처리한다. 결과를 다음 요청이 바로 확인해야 하는 작업(첨부 삭제, 조회수 등)은 기다린다.

**모듈 전역 상태**
- 같은 isolate가 여러 사용자의 요청을 처리하므로, 모듈 전역 변수에 **사용자·요청별 값**을 두지 않는다.
- 전역에 둘 수 있는 것은 상수와, 크기 상한이 있고 입력만으로 결과가 정해지는 계산 캐시(예: `sanitizePostHtml`의 정제 결과)뿐이다. 캐시 키에는 내용이 바뀌면 함께 바뀌는 값(입력 자체, 또는 id + 수정 시각)을 쓴다.

**무료 플랜 한도 (요청당 CPU 10ms)**
- 요청마다 반복되는 무거운 계산은 캐시하거나 저장할 때 한 번만 한다.
- 큰 바이트 배열을 문자열로 바꿀 때 한 바이트씩 `+=`로 이어 붙이지 않는다. 조각(32KB)씩 `String.fromCharCode(...chunk)`로 바꾼다 (예: `encodeEditorInit`).
- 비밀번호 해시는 PBKDF2 10만 회로 둔다 (2026-10-21 결정, 로그인 요청은 약 28ms).
- 정적 파일은 `public/`에 두어 Worker를 거치지 않게 한다 (Worker 요청 수·CPU에 포함되지 않음). 정적 파일 헤더는 `public/_headers`에서 정한다.

**D1**
- 서로 기다릴 필요가 없는 쿼리 여러 개는 `db.batch([...])`로 한 번에 보낸다 (왕복 1회).
- 값은 항상 `?` 자리에 `.bind()`로 넣는다. SQL 문자열에 사용자 값을 이어 붙이지 않는다. 이어 붙여도 되는 것은 코드 안의 상수 조각(`NOW_SQL`, `POST_GLOBAL_NUM_JOIN`, `LIST_POST_COLUMNS`, `UNREFERENCED_ASSET_SQL`)과, 값 개수만큼 만든 자리표시자(`IN (?, ?, …)`)뿐이다.
- 목록 화면 쿼리는 `p.*` 대신 `LIST_POST_COLUMNS`를 쓴다. 게시물 본문(`content`)은 수 MB가 될 수 있어 목록에서는 읽지 않는다.
- 모든 행의 큰 텍스트를 Worker로 읽어 와서 검사하지 않는다. 검사는 SQL 안에서 끝낸다 (예: 첨부 참조 확인 `UNREFERENCED_ASSET_SQL`, 알림 썸네일은 본문 일부만 `substr`).
- 값 하나는 D1 상한(2,000,000바이트)을 넘을 수 없다. 게시물 본문은 저장 전에 `isOverD1ValueLimit`(`src/lib/dbLimits.ts`)로 확인하고, 넘으면 안내 문구와 함께 폼을 다시 그린다. D1 상한 값은 `dbLimits.ts` 한 곳에 둔다.
- 사이트 설정 HTML(사이트 이름·자기소개)은 `SETTING_HTML_MAX_CHARS`(64K자)까지만 저장한다. 메인 화면이 매 요청 정제하므로 입력 자체를 캐시 키로 쓸 수 있는 길이여야 한다.
- 본문 첨부 주소가 들어갈 수 있는 HTML(게시물 본문·사이트 설정)을 저장할 때는 같은 batch에 `buildMarkAttachedStatements`를 넣는다. Cron 정리는 한 번도 붙지 않은 첨부만 검사하므로, 저장으로 참조가 빠지는 곳(게시물 수정·삭제, 사이트 설정 저장)은 모두 빠진 id를 `deleteAssetsIfUnreferenced`로 넘긴다.
- 무료 플랜은 요청당 D1 쿼리 수에 상한이 있으므로, 여러 행을 지우거나 고칠 때는 행마다 쿼리를 만들지 말고 `IN (…)`으로 묶는다 (쿼리당 바인딩 값은 100개까지).
- R2 일괄 삭제(`MEDIA.delete([...])`)는 한 번에 1000개까지다. 그보다 많으면 나눠서 보낸다.
- 시간은 ISO 8601 UTC 문자열로 저장한다. 새로 쓰는 시각은 SQL에서 `NOW_SQL`을 쓴다.
  - 예외: `rate_limits.window_start`는 밀리초 단위 UNIX 시간(정수)이다. 시간 창 계산을 숫자 비교 한 번으로 하기 위해서이며, 이미 적용한 `0002_rate_limits.sql`이라 바꾸지 않는다.
- 스키마는 `migrations/`에 **새 번호 파일**을 추가해서만 바꾼다. 이미 적용한 마이그레이션 파일은 고치지 않는다.
- 행끼리의 관계는 외래 키(`ON DELETE CASCADE`)로 정리한다. D1은 외래 키를 항상 검사한다.

**R2**
- 큰 업로드(본문 첨부, 최대 55MB)는 multipart로 받아 메모리에 모으지 말고, 파일 본문을 그대로 받아 `streamUploadToR2`로 R2에 바로 흘려보낸다 (isolate 메모리 128MB).
- 요청 본문 크기는 읽기 전에 막는다. 모든 요청은 앱 맨 앞의 `limitRequestBody`(12MB, Content-Type과 chunked 본문 모두 적용)를 지난다. 짧은 값만 받는 폼(로그인·댓글)은 같은 미들웨어의 `SMALL_FORM_PATHS`에 경로를 넣어 64KB로 막고(본문을 읽는 `_method` 처리보다 먼저여야 함), 파일이 있는 폼은 `isFormBodyTooLarge`로 파일 상한을 먼저 확인한다. 예외는 R2로 바로 흘려보내는 `/posts/body-upload`에 첨부 형식(`MEDIA_MIMES`)으로 보낸 POST(자체 55MB 상한)뿐이다.
- 미들웨어에서 본문을 읽어야 하면 `c.req.raw.clone()` 대신 `c.req.text()` 등 Hono가 캐시하는 메서드를 써서, 라우트가 같은 본문을 다시 받지 않게 한다.
- 파일은 R2, 메타데이터는 D1에 둔다. DB에 파일 내용을 넣지 않는다.
- 키 형식: `avatars/<사용자 id>/<uuid>`, `post-body/<uuid>`, `site/profile-image/<uuid>`. 파일을 바꿀 때는 새 키로 올리고 옛 키를 지운다.
- 이미지 응답은 ETag와 조건부 요청(304)을 지원한다.

## 6. 보안 규칙

- 사용자가 넣은 HTML은 `sanitizePostHtml`(sanitize-html, 기존 허용 목록)만으로 정제한다. 다른 정제기로 바꾸지 않는다 (2026-10-22 HTMLRewriter 판에서 XSS가 발견됨).
- 화면 출력은 JSX의 기본 이스케이프를 쓴다. `RawHtml`·`raw()`·`InlineScript`에는 정제했거나 `escapeJsonForScript`로 이스케이프한 값만 넣는다.
- 상태를 바꾸는 요청은 POST(+`_method`)로만 받는다. GET으로 데이터를 바꾸지 않는다. 출처 검사(`requireSameOrigin`)를 우회하는 라우트를 만들지 않는다.
- 경로·폼의 id는 `parseId`로 검사한다. 로그인 후 이동 경로는 `toSafeRedirectPath`로 검사한다.
- 업로드 파일의 형식은 브라우저가 보낸 MIME이 아니라 파일 앞부분(`detectVerifiedMime`)으로 판별한다.
- 권한이 필요한 라우트는 `requireLogin`·`requireAdmin`을 쓰고, 남의 글·댓글을 고치는 경우 작성자 확인을 따로 한다.
- 세션 토큰·보안 문자 정답 등 쿠키 값은 서명하거나 해시로만 저장한다.

## 7. 화면과 브라우저 스크립트

- 화면의 id·class·`data-*` 속성은 `public/js/`의 스크립트가 쓰는 이름과 맞춘다. 바꿀 때는 스크립트와 브라우저 테스트를 함께 고친다.
- `public/js/`는 빌드 없이 그대로 쓰는 일반 스크립트다 (모듈·번들러 없음). 외부 스크립트를 새로 불러오면 CSP(`src/lib/security.ts`)도 함께 확인한다.
- 모든 화면은 `Layout`으로 감싸서 DOCTYPE·공통 헤더를 붙인다.

## 8. 테스트·커밋·배포 절차

1. 작업은 브랜치에서 한다. master에 직접 커밋하지 않는다.
2. 동작을 바꾸면 테스트를 추가하거나 고친다.
3. 커밋 전에 모두 통과해야 한다.
   - `npm run lint` — 브라우저·Node 스크립트 문법
   - `npm run typecheck` — TypeScript
   - `npm test` — 통합 테스트 (wrangler dev + 로컬 D1·R2)
   - `npm run test:browser` — 헤드리스 Chrome
4. 커밋 메시지는 한국어로, 첫 줄에 바뀐 점을 요약하고 본문에 이유를 적는다.
5. 브랜치를 push하고 PR을 만들어 GitHub Actions CI가 통과한 뒤에 master에 합친다.
6. 배포는 CI가 아니라 `npm run deploy`(wrangler)로 직접 한다. 스키마를 바꿨다면 배포 전에 `npm run db:migrate:remote`를 먼저 실행한다.
7. 작업한 날에는 `UPDATES.md`에 그날 바뀐 점을 적는다.
