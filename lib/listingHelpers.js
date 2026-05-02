/**
 * 게시판·전체 게시물 목록에서 공통 사용
 */
function formatListTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mi}`;
  }
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}.${mm}.${dd}`;
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

module.exports = { formatListTime, buildPaginationItems };
