const sanitizeHtml = require('sanitize-html');

/* CSS 값: url()/expression()/import 등 외부 로드·실행 경로 차단 */
const SAFE_CSS_VALUE = /^(?!.*(?:url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:))[^<>{};]*$/i;
const STYLE_PROPS = [
  'color', 'background-color', 'background', 'font-size', 'font-family', 'font-weight', 'font-style',
  'text-decoration', 'text-decoration-line', 'text-align', 'text-indent', 'line-height', 'letter-spacing',
  'vertical-align', 'white-space', 'width', 'height', 'max-width', 'min-width', 'margin', 'margin-top',
  'margin-bottom', 'margin-left', 'margin-right', 'padding', 'padding-top', 'padding-bottom',
  'padding-left', 'padding-right', 'border', 'border-collapse', 'list-style-type', 'display'
];
const allowedStyles = { '*': {} };
STYLE_PROPS.forEach((p) => {
  allowedStyles['*'][p] = [SAFE_CSS_VALUE];
});

const YOUTUBE_IFRAME_HOSTS = ['www.youtube-nocookie.com', 'youtube-nocookie.com', 'www.youtube.com', 'youtube.com'];

/**
 * 게시물 본문·메인 자기소개·사이트 이름 HTML — 허용 목록 기반 정제.
 * 에디터(contenteditable)가 만들거나 붙여넣기로 들어올 수 있는 서식 태그는 유지하고,
 * 스크립트·이벤트 핸들러·위험한 URL 스킴·외부 iframe(YouTube 제외)은 제거한다.
 */
const SANITIZE_OPTIONS = {
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

function sanitizePostHtml(html) {
  return sanitizeHtml(String(html || ''), SANITIZE_OPTIONS);
}

function escapeHtmlText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 레거시 일반 텍스트 본문: 이스케이프 후 줄바꿈만 <br>로 */
function plainTextToHtml(text) {
  return escapeHtmlText(text).replace(/\r\n|\r|\n/g, '<br>');
}

function isPostContentMeaningful(html) {
  const raw = String(html || '');
  if (/<(?:img|video|iframe)\b/i.test(raw)) return true;
  const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 0;
}

function postContentLooksLikeHtml(content) {
  return typeof content === 'string' && /<\s*[a-z][\s\S]*>/i.test(content);
}

/** 브라우저 `<title>`·내비게이션 라벨용 — 태그 제거 후 공백 정리 */
function stripHtmlToPlain(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 메인 페이지 자기소개(contenteditable): Enter 처리 과정에서 생기는 빈 블록(<div><br></div> 등)은
 * 저장·표시 시에는 줄 하나 높이의 빈 공간으로 보이므로 반복 제거한다.
 */
function normalizeBioHtml(html) {
  let s = String(html || '');
  for (let i = 0; i < 32; i += 1) {
    const next = s
      .replace(/<div\b[^>]*>\s*<\/div>/gi, '')
      .replace(/<p\b[^>]*>\s*<\/p>/gi, '')
      .replace(/<div\b[^>]*>\s*(?:<br\s*\/?>|&nbsp;|&#160;|\u00a0|\s)*\s*<\/div>/gi, '')
      .replace(/<p\b[^>]*>\s*(?:<br\s*\/?>|&nbsp;|&#160;|\u00a0|\s)*\s*<\/p>/gi, '');
    if (next === s) break;
    s = next;
  }
  return s;
}

function sanitizeBioHtml(html) {
  return normalizeBioHtml(sanitizePostHtml(html));
}

module.exports = {
  sanitizePostHtml,
  sanitizeBioHtml,
  normalizeBioHtml,
  isPostContentMeaningful,
  postContentLooksLikeHtml,
  stripHtmlToPlain,
  escapeHtmlText,
  plainTextToHtml
};
