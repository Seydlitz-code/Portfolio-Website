/**
 * 게시물 본문·메인 자기소개·사이트 이름 HTML 정제 (기존 lib/postHtml.js 이식).
 *
 * 기존에는 sanitize-html을 썼지만, 여기서는 Workers 내장 HTMLRewriter로 같은 허용 목록 규칙을 적용한다.
 * 내장 파서라 CPU를 적게 쓴다.
 *   - 허용하지 않는 태그: 태그만 지우고 안의 글은 남긴다 (script·style 등은 내용까지 지움)
 *   - 허용하지 않는 속성·이벤트 핸들러: 지움
 *   - href/src/cite/poster: http, https, mailto, tel과 상대 경로만 (img src는 data:도 허용)
 *   - iframe: YouTube 주소만 남김
 *   - style: 허용한 CSS 속성만, url()/expression() 등은 지움
 */

const BASE_TAGS = [
  // sanitize-html 기본 허용 태그
  'address', 'article', 'aside', 'footer', 'header', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hgroup', 'main',
  'nav', 'section', 'blockquote', 'dd', 'div', 'dl', 'dt', 'figcaption', 'figure', 'hr', 'li', 'ol', 'p',
  'pre', 'ul', 'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark',
  'q', 'rb', 'rp', 'rt', 'rtc', 'ruby', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u',
  'var', 'wbr', 'caption', 'col', 'colgroup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  // 기존 프로젝트에서 추가로 허용한 태그
  'img', 'video', 'source', 'iframe', 'font', 'strike', 'del', 'ins', 'center'
];
const ALLOWED_TAGS = new Set(BASE_TAGS);

/** 내용까지 통째로 지우는 태그 (sanitize-html의 nonTextTags) */
const DROP_WITH_CONTENT = new Set(['script', 'style', 'textarea', 'option', 'noscript']);

const GLOBAL_ATTRS = ['class', 'style', 'title', 'lang', 'dir', 'align'];
const TAG_ATTRS: Record<string, string[]> = {
  a: ['href', 'name', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
  video: ['src', 'controls', 'playsinline', 'preload', 'poster', 'width', 'height', 'muted', 'loop'],
  source: ['src', 'type'],
  iframe: ['src', 'title', 'allow', 'allowfullscreen', 'referrerpolicy', 'loading', 'width', 'height', 'frameborder'],
  font: ['color', 'face', 'size'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan']
};

const URL_ATTRS = new Set(['href', 'src', 'cite', 'poster']);
const ALLOWED_SCHEMES = ['http', 'https', 'mailto', 'tel'];
const IMG_SCHEMES = ['http', 'https', 'data'];
const YOUTUBE_IFRAME_HOSTS = new Set(['www.youtube-nocookie.com', 'youtube-nocookie.com', 'www.youtube.com', 'youtube.com']);

/* CSS 값: url()/expression()/import 등 외부 로드·실행 경로 차단 */
const SAFE_CSS_VALUE = /^(?!.*(?:url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:))[^<>{};]*$/i;
const STYLE_PROPS = new Set([
  'color', 'background-color', 'background', 'font-size', 'font-family', 'font-weight', 'font-style',
  'text-decoration', 'text-decoration-line', 'text-align', 'text-indent', 'line-height', 'letter-spacing',
  'vertical-align', 'white-space', 'width', 'height', 'max-width', 'min-width', 'margin', 'margin-top',
  'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom',
  'padding-left', 'padding-right', 'border', 'border-collapse', 'list-style-type', 'display'
]);

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '\t')
    .replace(/&newline;/gi, '\n')
    .replace(/&amp;/gi, '&');
}

/** sanitize-html의 naughtyHref와 같은 판단: 허용하지 않는 스킴이면 true */
/** URL 앞뒤·중간에 숨겨 넣은 제어 문자·공백(스킴 검사 우회용)을 지울 때 쓰는 문자 집합 */
const INVISIBLE_URL_CHARS = new RegExp(
  '[' + [[0x00, 0x20], [0x7f, 0xa0], [0x200b, 0x200f], [0x2028, 0x2029], [0xfeff, 0xfeff]]
    .map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b))
    .join('') + ']+',
  'g'
);

function isNaughtyUrl(raw: string, schemes: string[]): boolean {
  const href = decodeEntities(raw)
    .replace(/<!--.*?-->/g, '')
    .replace(INVISIBLE_URL_CHARS, '');
  if (href.startsWith('//') || href.startsWith('\\\\') || href.startsWith('/\\') || href.startsWith('\\/')) {
    return true; // 프로토콜 상대 주소는 허용하지 않음
  }
  const m = /^([a-zA-Z][a-zA-Z0-9.\-+]*):/.exec(href);
  if (!m) return false; // 상대 경로
  return !schemes.includes(m[1].toLowerCase());
}

function filterStyle(value: string): string {
  const out: string[] = [];
  for (const decl of value.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const v = decl.slice(i + 1).trim();
    if (!prop || !v || !STYLE_PROPS.has(prop) || !SAFE_CSS_VALUE.test(v)) continue;
    out.push(`${prop}:${v}`);
  }
  return out.join(';');
}

function iframeSrcAllowed(src: string): boolean {
  try {
    const u = new URL(decodeEntities(src).trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') && YOUTUBE_IFRAME_HOSTS.has(u.hostname.toLowerCase());
  } catch {
    return false; // 상대 주소 iframe은 허용하지 않음
  }
}

const elementHandler: HTMLRewriterElementContentHandlers = {
  element(el) {
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      if (DROP_WITH_CONTENT.has(tag)) el.remove();
      else el.removeAndKeepContent();
      return;
    }
    const allowed = new Set([...GLOBAL_ATTRS, ...(TAG_ATTRS[tag] ?? [])]);
    const names = [...el.attributes].map(([name]) => name);
    for (const name of names) {
      const lower = name.toLowerCase();
      const value = el.getAttribute(name) ?? '';
      if (!allowed.has(lower)) {
        el.removeAttribute(name);
        continue;
      }
      if (URL_ATTRS.has(lower)) {
        const schemes = tag === 'img' && lower === 'src' ? IMG_SCHEMES : ALLOWED_SCHEMES;
        if (isNaughtyUrl(value, schemes) || (tag === 'iframe' && lower === 'src' && !iframeSrcAllowed(value))) {
          el.removeAttribute(name);
        }
        continue;
      }
      if (lower === 'style') {
        const filtered = filterStyle(value);
        if (filtered) el.setAttribute(name, filtered);
        else el.removeAttribute(name);
      }
    }
    if (tag === 'a' && el.getAttribute('target') === '_blank') {
      el.setAttribute('rel', 'noopener noreferrer');
    }
  },
  comments(comment) {
    comment.remove();
  }
};

export async function sanitizePostHtml(html: unknown): Promise<string> {
  const input = String(html ?? '');
  if (!input) return '';
  const res = new HTMLRewriter()
    .on('*', elementHandler)
    .onDocument({
      comments(c) {
        c.remove();
      },
      doctype() {
        /* 문서 선언은 본문에 필요 없다 */
      }
    })
    .transform(new Response(input, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  return (await res.text()).replace(/<!doctype[^>]*>/gi, '');
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
