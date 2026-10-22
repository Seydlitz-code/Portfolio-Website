/**
 * 게시물 본문·메인 자기소개·사이트 이름 HTML 정제 (기존 lib/postHtml.js와 같은 라이브러리·설정).
 *
 * 처음에는 Workers 내장 HTMLRewriter로 같은 허용 목록을 흉내 냈지만, HTMLRewriter는 남은 텍스트를
 * 다시 이스케이프하지 않아 <xmp> 안의 태그나 닫히지 않은 태그가 그대로 살아나는 문제가 있었다.
 * 그래서 원래 서버와 같은 sanitize-html을 같은 옵션으로 쓴다 (출력을 새로 만들고 모든 텍스트를 이스케이프함).
 * 에디터(contenteditable)가 만들거나 붙여넣기로 들어올 수 있는 서식 태그는 유지하고,
 * 스크립트·이벤트 핸들러·위험한 URL 스킴·외부 iframe(YouTube 제외)은 제거한다.
 */
import sanitizeHtml from 'sanitize-html';

/* CSS 값: url()/expression()/import 등 외부 로드·실행 경로 차단 */
const SAFE_CSS_VALUE = /^(?!.*(?:url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:))[^<>{};]*$/i;
const STYLE_PROPERTIES = [
  'color', 'background-color', 'background', 'font-size', 'font-family', 'font-weight', 'font-style',
  'text-decoration', 'text-decoration-line', 'text-align', 'text-indent', 'line-height', 'letter-spacing',
  'vertical-align', 'white-space', 'width', 'height', 'max-width', 'min-width', 'margin', 'margin-top',
  'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom',
  'padding-left', 'padding-right', 'border', 'border-collapse', 'list-style-type', 'display'
];
const ALLOWED_STYLES: Record<string, Record<string, RegExp[]>> = { '*': {} };
for (const property of STYLE_PROPERTIES) ALLOWED_STYLES['*'][property] = [SAFE_CSS_VALUE];

const YOUTUBE_IFRAME_HOSTS = ['www.youtube-nocookie.com', 'youtube-nocookie.com', 'www.youtube.com', 'youtube.com'];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat([
    'img', 'video', 'source', 'iframe', 'span', 'font', 'u', 's', 'strike', 'del', 'ins',
    'sub', 'sup', 'mark', 'h1', 'h2', 'figure', 'figcaption', 'center'
  ]),
  allowedAttributes: {
    '*': ['class', 'style', 'title', 'lang', 'dir', 'align'],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    video: ['src', 'controls', 'playsinline', 'preload', 'poster', 'width', 'height', 'muted', 'loop'],
    source: ['src', 'type'],
    iframe: ['src', 'title', 'allow', 'allowfullscreen', 'referrerpolicy', 'loading', 'width', 'height', 'frameborder'],
    font: ['color', 'face', 'size'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan']
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'poster'],
  allowProtocolRelative: false,
  allowedIframeHostnames: YOUTUBE_IFRAME_HOSTS,
  allowIframeRelativeUrls: false,
  allowedStyles: ALLOWED_STYLES,
  transformTags: {
    a: (tagName, attribs) => {
      const out = { ...attribs };
      if (out.target === '_blank') out.rel = 'noopener noreferrer';
      return { tagName, attribs: out };
    }
  }
};

/*
 * 정제 결과 캐시. 사이트 이름·자기소개·게시물 본문은 저장할 때 이미 정제했지만, 출력할 때 한 번 더
 * 정제해 두 겹으로 막는다. 대신 같은 isolate의 다음 요청에서는 결과를 재사용해 CPU(무료 플랜 10ms)를 아낀다.
 * - 짧은 값(사이트 이름 등)은 입력 문자열 자체를 키로 쓴다.
 * - 게시물 본문처럼 긴 값은 호출하는 쪽이 키(게시물 id + 수정 시각)를 넘긴다. 내용이 바뀌면 키도 바뀐다.
 * 전체 글자 수 상한을 두어 메모리(isolate 128MB)가 늘지 않게 하고, 넘치면 가장 오래 안 쓴 항목부터 지운다.
 */
/** 캐시에 담는 전체 글자 수 상한: 600만 자 (최대 약 12MB, 큰 글 3개 정도) */
const SANITIZE_CACHE_BUDGET_CHARS = 6 * 1000 * 1000;
/**
 * 항목 하나의 최대 크기: 200만 자. D1 값 하나의 상한(2,000,000바이트)보다 긴 글은 저장될 수 없으므로,
 * 저장된 글은 크기와 관계없이 모두 캐시할 수 있다 (매 조회마다 큰 글을 다시 정제하지 않게).
 */
const SANITIZE_CACHE_ENTRY_MAX_CHARS = 2 * 1000 * 1000;
/** 입력 자체를 키로 쓸 수 있는 최대 길이 */
const SANITIZE_INPUT_KEY_MAX_CHARS = 64 * 1024;
/**
 * 사이트 설정 HTML(사이트 이름·자기소개)의 최대 길이: 64K자.
 * 메인 화면이 매번 키 없이 정제하므로, 입력 자체를 캐시 키로 쓸 수 있는 길이까지만 저장을 허용한다.
 */
export const SETTING_HTML_MAX_CHARS = SANITIZE_INPUT_KEY_MAX_CHARS;

const sanitizeCache = new Map<string, string>();
let sanitizeCacheChars = 0;

function rememberSanitized(key: string, output: string): void {
  const size = key.length + output.length;
  if (size > SANITIZE_CACHE_ENTRY_MAX_CHARS) return;
  sanitizeCache.set(key, output);
  sanitizeCacheChars += size;
  for (const [oldKey, oldValue] of sanitizeCache) {
    if (sanitizeCacheChars <= SANITIZE_CACHE_BUDGET_CHARS) break;
    sanitizeCache.delete(oldKey);
    sanitizeCacheChars -= oldKey.length + oldValue.length;
  }
}

/**
 * 사용자 HTML 정제. cacheKey를 주면 그 키로, 안 주면 (짧은 입력에 한해) 입력 자체로 결과를 캐시한다.
 * 호출하는 쪽 코드를 바꾸지 않도록 비동기 형태를 유지한다.
 */
export async function sanitizePostHtml(html: unknown, cacheKey?: string): Promise<string> {
  const input = String(html ?? '');
  const key = cacheKey ?? (input.length <= SANITIZE_INPUT_KEY_MAX_CHARS ? `in:${input}` : null);
  return computeWithCache(key, () => sanitizeHtml(input, SANITIZE_OPTIONS));
}

/** key가 있으면 캐시에서 찾고, 없으면 compute 결과를 캐시에 넣는다. key가 null이면 캐시하지 않는다. */
function computeWithCache(key: string | null, compute: () => string): string {
  if (key == null) return compute();
  const cached = sanitizeCache.get(key);
  if (cached !== undefined) {
    // 최근에 쓴 항목을 뒤로 옮겨, 넘칠 때 가장 오래 안 쓴 항목부터 지워지게 한다.
    sanitizeCache.delete(key);
    sanitizeCache.set(key, cached);
    return cached;
  }
  const output = compute();
  rememberSanitized(key, output);
  return output;
}

function escapeHtmlText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 레거시 일반 텍스트 본문: 이스케이프 후 줄바꿈만 <br>로 */
export function convertPlainTextToHtml(text: unknown): string {
  return escapeHtmlText(text).replace(/\r\n|\r|\n/g, '<br>');
}

/** 본문에 글자나 미디어(img·video·iframe)가 하나라도 있는지 */
export function isPostContentMeaningful(html: unknown): boolean {
  const raw = String(html ?? '');
  if (/<(?:img|video|iframe)\b/i.test(raw)) return true;
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length > 0;
}

/** 본문이 HTML인지 (아주 오래된 글은 일반 텍스트로 저장돼 있을 수 있음) */
export function isHtmlContent(content: unknown): boolean {
  return typeof content === 'string' && /<\s*[a-z][\s\S]*>/i.test(content);
}

/** 브라우저 <title>·내비게이션 라벨용: 태그 제거 후 공백 정리 */
export function stripHtmlToPlain(html: unknown): string {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 빈 블록이 겹겹이 중첩된 경우를 위해 반복하는 최대 횟수 */
const BIO_NORMALIZE_MAX_PASSES = 32;

/**
 * 메인 자기소개(contenteditable)에서 Enter로 생기는 빈 블록(<div><br></div> 등)을 지운다.
 * 저장·표시하면 빈 줄로만 보이기 때문이다.
 * 정규식은 공백을 한 가지 방법으로만 나눠 먹게 쓴다. 공백 반복을 앞뒤로 겹쳐 두면(`\s*(…|\s)*\s*`) 긴 공백에서
 * 되추적이 세제곱으로 늘어 CPU 10ms를 넘는다.
 */
function normalizeBioHtml(html: string): string {
  let current = String(html || '');
  for (let i = 0; i < BIO_NORMALIZE_MAX_PASSES; i += 1) {
    const next = current
      .replace(/<div\b[^>]*>(?:<br\s*\/?>|&nbsp;|&#160;|\s)*<\/div>/gi, '')
      .replace(/<p\b[^>]*>(?:<br\s*\/?>|&nbsp;|&#160;|\s)*<\/p>/gi, '');
    if (next === current) break;
    current = next;
  }
  return current;
}

/** 자기소개 정제 + 빈 블록 정리. 메인 화면이 매번 부르므로 두 단계를 합친 결과를 캐시한다. */
export async function sanitizeBioHtml(html: unknown): Promise<string> {
  const input = String(html ?? '');
  const key = input.length <= SANITIZE_INPUT_KEY_MAX_CHARS ? `bio:${input}` : null;
  return computeWithCache(key, () => normalizeBioHtml(sanitizeHtml(input, SANITIZE_OPTIONS)));
}

/** 사이트 이름 → 일반 텍스트 (title·로고용) */
export async function toSitePlainText(html: unknown): Promise<string> {
  return stripHtmlToPlain(await sanitizePostHtml(html ?? ''));
}

/** <script> 안에 JSON을 넣을 때 </script> 탈출·HTML 주석 해석을 막도록 이스케이프할 문자 */
const SCRIPT_UNSAFE_CHARS = new RegExp('[<>&' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

/** JSON 문자열로 바꾸고 <, >, &, 줄 구분자를 유니코드 이스케이프로 바꾼다 */
export function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(
    SCRIPT_UNSAFE_CHARS,
    (char) => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')
  );
}
