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
const STYLE_PROPS = [
  'color', 'background-color', 'background', 'font-size', 'font-family', 'font-weight', 'font-style',
  'text-decoration', 'text-decoration-line', 'text-align', 'text-indent', 'line-height', 'letter-spacing',
  'vertical-align', 'white-space', 'width', 'height', 'max-width', 'min-width', 'margin', 'margin-top',
  'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom',
  'padding-left', 'padding-right', 'border', 'border-collapse', 'list-style-type', 'display'
];
const allowedStyles: Record<string, Record<string, RegExp[]>> = { '*': {} };
for (const p of STYLE_PROPS) allowedStyles['*'][p] = [SAFE_CSS_VALUE];

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
  allowedStyles,
  transformTags: {
    a: (tagName, attribs) => {
      const out = { ...attribs };
      if (out.target === '_blank') out.rel = 'noopener noreferrer';
      return { tagName, attribs: out };
    }
  }
};

/** 호출하는 쪽 코드를 바꾸지 않도록 비동기 형태를 유지한다. */
export async function sanitizePostHtml(html: unknown): Promise<string> {
  return sanitizeHtml(String(html ?? ''), SANITIZE_OPTIONS);
}

export function escapeHtmlText(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 레거시 일반 텍스트 본문: 이스케이프 후 줄바꿈만 <br>로 */
export function plainTextToHtml(text: unknown): string {
  return escapeHtmlText(text).replace(/\r\n|\r|\n/g, '<br>');
}

export function isPostContentMeaningful(html: unknown): boolean {
  const raw = String(html ?? '');
  if (/<(?:img|video|iframe)\b/i.test(raw)) return true;
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length > 0;
}

export function postContentLooksLikeHtml(content: unknown): boolean {
  return typeof content === 'string' && /<\s*[a-z][\s\S]*>/i.test(content);
}

/** 브라우저 <title>·내비게이션 라벨용: 태그 제거 후 공백 정리 */
export function stripHtmlToPlain(html: unknown): string {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 메인 자기소개(contenteditable)에서 Enter로 생기는 빈 블록(<div><br></div> 등)을 지운다.
 * 저장·표시하면 빈 줄로만 보이기 때문이다.
 */
export function normalizeBioHtml(html: string): string {
  let s = String(html || '');
  for (let i = 0; i < 32; i += 1) {
    const next = s
      .replace(/<div\b[^>]*>\s*<\/div>/gi, '')
      .replace(/<p\b[^>]*>\s*<\/p>/gi, '')
      .replace(/<div\b[^>]*>\s*(?:<br\s*\/?>|&nbsp;|&#160;|\s)*\s*<\/div>/gi, '')
      .replace(/<p\b[^>]*>\s*(?:<br\s*\/?>|&nbsp;|&#160;|\s)*\s*<\/p>/gi, '');
    if (next === s) break;
    s = next;
  }
  return s;
}

export async function sanitizeBioHtml(html: unknown): Promise<string> {
  return normalizeBioHtml(await sanitizePostHtml(html));
}

/** 사이트 이름 → 일반 텍스트 (title·로고용) */
export async function sitePlainText(html: unknown): Promise<string> {
  return stripHtmlToPlain(await sanitizePostHtml(html ?? ''));
}

/* <script> 안에 JSON을 넣을 때 </script> 탈출·HTML 주석 해석 방지 */
const SCRIPT_UNSAFE_CHARS = new RegExp('[<>&' + String.fromCharCode(0x2028, 0x2029) + ']', 'g');

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(
    SCRIPT_UNSAFE_CHARS,
    (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0')
  );
}
