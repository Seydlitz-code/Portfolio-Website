/**
 * 서버 렌더 시 기본 표시 시간대. 브라우저에서는 public/js/local-time.js가
 * <time data-local-time> 요소를 방문자 시간대로 다시 표시한다.
 */
const DISPLAY_FALLBACK_TZ = 'Asia/Seoul';

/**
 * DB 시각 → Date.
 * SQLite CURRENT_TIMESTAMP는 시간대 없는 UTC 문자열('YYYY-MM-DD HH:MM:SS')이라
 * new Date()가 서버 로컬 시간으로 잘못 해석하므로 UTC로 명시한다. PG(timestamptz)는 Date로 온다.
 */
function parseDbTime(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(s);
  const d = m ? new Date(`${m[1]}T${m[2]}Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** <time datetime>·클라이언트 변환용 ISO 8601 UTC 문자열 */
function toIsoUtc(v) {
  const d = parseDbTime(v);
  return d ? d.toISOString() : '';
}

function zonedParts(d, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(d);
  const o = {};
  parts.forEach((p) => {
    o[p.type] = p.value;
  });
  return o;
}

/**
 * 게시판·전체 게시물 목록에서 공통 사용
 * 년·월·일·시·분 (서버 기본: 한국 시간)
 */
function formatListTime(iso) {
  const d = parseDbTime(iso);
  if (!d) return '';
  const p = zonedParts(d, DISPLAY_FALLBACK_TZ);
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}`;
}

/** 댓글 시각: 'YYYY년 M월 D일 HH:MM' (서버 기본: 한국 시간) */
function formatCommentDateTime(iso) {
  const d = parseDbTime(iso);
  if (!d) return '';
  return d.toLocaleString('ko-KR', {
    timeZone: DISPLAY_FALLBACK_TZ,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/** 작성 후 2초 넘게 지나 수정됐는지 */
function isEditedAfterCreate(createdAt, updatedAt) {
  const c = parseDbTime(createdAt);
  const u = parseDbTime(updatedAt);
  if (!c || !u) return false;
  return u.getTime() - c.getTime() > 2000;
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
  parseDbTime,
  toIsoUtc,
  formatListTime,
  formatCommentDateTime,
  isEditedAfterCreate,
  buildPaginationItems,
  truncatePostTitleLine,
  truncateBoardNameLine,
  LIST_TITLE_MAX,
  LIST_TITLE_ELLIPSIS,
  LIST_BOARD_NAME_MAX,
  LIST_BOARD_ELLIPSIS,
  LIST_BOARD_NAME_ALL_POSTS_MAX
};
