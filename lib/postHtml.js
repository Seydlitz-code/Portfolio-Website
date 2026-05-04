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

module.exports = { sanitizePostHtml, isPostContentMeaningful, postContentLooksLikeHtml };
