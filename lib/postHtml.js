/**
 * 관리자 전용 게시 HTML — 스크립트·이벤트 핸들러 등 최소 제거.
 */
function sanitizePostHtml(html) {
  let s = String(html || '');
  s = s.replace(/<\/(?:script|style)[^>]*>/gi, '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/javascript:/gi, '');
  s = s.replace(/data:text\/html/gi, '');
  return s;
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
  stripHtmlToPlain
};
