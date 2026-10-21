/**
 * 시간 표시·목록 보조 (기존 lib/listingHelpers.js 이식).
 * 서버 렌더 시 기본 표시 시간대는 한국 시간이고, 브라우저에서는 public/js/local-time.js가
 * <time data-local-time> 요소를 방문자 시간대로 다시 그린다.
 */
const DISPLAY_FALLBACK_TZ = 'Asia/Seoul';

/** D1에 저장할 현재 시각 (ISO 8601 UTC). SQL 안에서는 NOW_SQL을 쓴다. */
export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/**
 * DB 시각 → Date.
 * 'YYYY-MM-DD HH:MM:SS'처럼 시간대가 없는 값은 UTC로 해석한다.
 */
export function parseDbTime(v: unknown): Date | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(s);
  const d = m ? new Date(`${m[1]}T${m[2]}Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** <time datetime>·클라이언트 변환용 ISO 8601 UTC 문자열 */
export function toIsoUtc(v: unknown): string {
  const d = parseDbTime(v);
  return d ? d.toISOString() : '';
}

function zonedParts(d: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(d);
  const o: Record<string, string> = {};
  for (const p of parts) o[p.type] = p.value;
  return o;
}

/** 목록 시각: YYYY.MM.DD HH:MM (한국 시간) */
export function formatListTime(v: unknown): string {
  const d = parseDbTime(v);
  if (!d) return '';
  const p = zonedParts(d, DISPLAY_FALLBACK_TZ);
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}`;
}

/** 댓글 시각: 'YYYY년 M월 D일 HH:MM' (한국 시간) */
export function formatCommentDateTime(v: unknown): string {
  const d = parseDbTime(v);
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
export function isEditedAfterCreate(createdAt: unknown, updatedAt: unknown): boolean {
  const c = parseDbTime(createdAt);
  const u = parseDbTime(updatedAt);
  if (!c || !u) return false;
  return u.getTime() - c.getTime() > 2000;
}

const LIST_TITLE_MAX = 30;
const LIST_TITLE_ELLIPSIS = '......';
export const LIST_BOARD_NAME_MAX = 10;
const LIST_BOARD_ELLIPSIS = '...';
/** 전체 게시물 목록(/posts)의 게시판명 한 줄 */
export const LIST_BOARD_NAME_ALL_POSTS_MAX = 20;

export function truncatePostTitleLine(s: unknown, maxLen = LIST_TITLE_MAX): string {
  const t = s != null && String(s).trim() !== '' ? String(s).trim() : '';
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + LIST_TITLE_ELLIPSIS;
}

export function truncateBoardNameLine(s: unknown, maxLen = LIST_BOARD_NAME_MAX): string {
  const t = s != null && String(s).trim() !== '' ? String(s).trim() : '';
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + LIST_BOARD_ELLIPSIS;
}

export type PageItem = { type: 'page'; n: number; current: boolean } | { type: 'ellipsis' };

export function buildPaginationItems(current: number, total: number): PageItem[] {
  if (total <= 1) return [{ type: 'page', n: 1, current: current === 1 }];
  const items: PageItem[] = [];
  const pushPage = (n: number) => items.push({ type: 'page', n, current: n === current });
  if (total <= 11) {
    for (let i = 1; i <= total; i += 1) pushPage(i);
    return items;
  }
  const pushEllipsis = () => {
    if (items.length && items[items.length - 1].type !== 'ellipsis') items.push({ type: 'ellipsis' });
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

/** 쿼리 문자열의 page 값 → 1 이상의 정수 */
export function pageParam(v: string | undefined): number {
  return Math.max(1, parseInt(v ?? '', 10) || 1);
}
