/**
 * 게시판·전체 게시물 목록에서 공통 사용
 * 년·월·일·시·분 (로컬 타임존)
 */
function formatListTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}.${mo}.${day} ${hh}:${mi}`;
}

const LIST_TITLE_MAX = 30;
const LIST_TITLE_ELLIPSIS = '......';

function truncatePostTitleLine(s, maxLen = LIST_TITLE_MAX) {
  const t = s != null && String(s).trim() !== '' ? String(s).trim() : '';
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + LIST_TITLE_ELLIPSIS;
}

const LIST_BOARD_NAME_MAX = 10;
const LIST_BOARD_ELLIPSIS = '...';

/** 전체 게시물 목록(/posts) 게시판명 한 줄 — 메인 등은 LIST_BOARD_NAME_MAX(10) 사용 */
const LIST_BOARD_NAME_ALL_POSTS_MAX = 20;

/** 게시판명 한 줄 (메인·게시판 목록): 초과 시 말줄임 */
function truncateBoardNameLine(s, maxLen = LIST_BOARD_NAME_MAX) {
  const t = s != null && String(s).trim() !== '' ? String(s).trim() : '';
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + LIST_BOARD_ELLIPSIS;
}

function buildPaginationItems(current, total) {
  if (total <= 1) {
    return [{ type: 'page', n: 1, current: current === 1 }];
  }
  const items = [];
  const pushPage = (n) => {
    items.push({ type: 'page', n, current: n === current });
  };

  if (total <= 11) {
    for (let i = 1; i <= total; i += 1) pushPage(i);
    return items;
  }

  const pushEllipsis = () => {
    if (items.length && items[items.length - 1].type !== 'ellipsis') {
      items.push({ type: 'ellipsis' });
    }
  };

  pushPage(1);
  const left = Math.max(2, current - 2);
  const right = Math.min(total - 1, current + 2);

  if (left > 2) pushEllipsis();
  for (let i = left; i <= right; i += 1) pushPage(i);
  if (right < total - 1) pushEllipsis();
  pushPage(total);
  return items;
}

module.exports = {
  formatListTime,
  buildPaginationItems,
  truncatePostTitleLine,
  truncateBoardNameLine,
  LIST_TITLE_MAX,
  LIST_TITLE_ELLIPSIS,
  LIST_BOARD_NAME_MAX,
  LIST_BOARD_ELLIPSIS,
  LIST_BOARD_NAME_ALL_POSTS_MAX
};
