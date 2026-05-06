const { buildPaginationItems } = require('./listingHelpers');

function writingsListUrl(postPage, commentPage) {
  const p = Math.max(1, parseInt(postPage, 10) || 1);
  const c = Math.max(1, parseInt(commentPage, 10) || 1);
  const sp = new URLSearchParams();
  if (p > 1) sp.set('postPage', String(p));
  if (c > 1) sp.set('commentPage', String(c));
  const q = sp.toString();
  return q ? `/mypage/posts?${q}` : '/mypage/posts';
}

/** 비관리자(댓글만): commentPage 쿼리만 사용 */
function writingsCommentsOnlyUrl(commentPage) {
  const c = Math.max(1, parseInt(commentPage, 10) || 1);
  if (c <= 1) return '/mypage/posts';
  return `/mypage/posts?commentPage=${c}`;
}

/** posts DELETE / comment DELETE의 next 화이트리스트 검증 */
function sanitizeMypageWritingsNext(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t.includes('\r') || t.includes('\n')) return null;
  if (!t.startsWith('/mypage/posts')) return null;
  if (t.startsWith('//')) return null;
  if (t === '/mypage/posts') return '/mypage/posts';
  const q = t.indexOf('?');
  if (q === -1) return null;
  if (t.slice(0, q) !== '/mypage/posts') return null;
  const sp = new URLSearchParams(t.slice(q + 1));
  for (const k of sp.keys()) {
    if (k !== 'postPage' && k !== 'commentPage') return null;
  }
  const pp = sp.get('postPage');
  const cp = sp.get('commentPage');
  if (pp != null && (!/^\d+$/.test(pp) || parseInt(pp, 10) < 1)) return null;
  if (cp != null && (!/^\d+$/.test(cp) || parseInt(cp, 10) < 1)) return null;
  return t;
}

/** 20자 이상이면 20글자 후 말줄임(, 그 미만은 2줄 clamp용 원문) */
function commentPreviewParts(content) {
  const normalized = String(content ?? '')
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(normalized);
  const atLeast20 = chars.length >= 20;
  const previewText = atLeast20
    ? chars.slice(0, 20).join('') + (chars.length > 20 ? '…' : '')
    : normalized;
  const previewTwoLine = chars.length < 20;
  return {
    previewText,
    previewTwoLine
  };
}

function buildWritingsPager(currentPage, totalPages, hrefForPageNum) {
  const totalSafe = Math.max(1, Number(totalPages) || 1);
  const cur = Math.max(1, Math.min(currentPage, totalSafe));
  const items = [];
  items.push({
    kind: 'prev',
    label: '이전',
    href: cur > 1 ? hrefForPageNum(cur - 1) : null,
    disabled: cur <= 1
  });

  buildPaginationItems(cur, totalSafe).forEach((p) => {
    if (p.type === 'ellipsis') items.push({ kind: 'ellipsis' });
    else {
      items.push({
        kind: 'page',
        label: String(p.n),
        href: hrefForPageNum(p.n),
        current: Boolean(p.current)
      });
    }
  });

  items.push({
    kind: 'next',
    label: '다음',
    href: cur < totalSafe ? hrefForPageNum(cur + 1) : null,
    disabled: cur >= totalSafe
  });
  return items;
}

module.exports = {
  writingsListUrl,
  writingsCommentsOnlyUrl,
  sanitizeMypageWritingsNext,
  commentPreviewParts,
  buildWritingsPager
};
