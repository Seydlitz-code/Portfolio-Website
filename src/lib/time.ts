/**
 * 시간 표시·목록 보조 (기존 lib/listingHelpers.js 이식).
 * 서버 렌더 시 기본 표시 시간대는 한국 시간이고, 브라우저에서는 public/js/local-time.js가
 * <time data-local-time> 요소를 방문자 시간대로 다시 그린다.
 */
const DISPLAY_FALLBACK_TIME_ZONE = 'Asia/Seoul';

/** D1에 저장할 현재 시각 (ISO 8601 UTC). SQL 안에 그대로 넣어 쓴다. */
export const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** 이 시간 넘게 지나서 고쳤을 때만 '수정됨'으로 표시한다 (저장 직후 자동 갱신과 구분) */
const EDITED_THRESHOLD_MS = 2000;

/**
 * DB 시각 → Date.
 * 'YYYY-MM-DD HH:MM:SS'처럼 시간대가 없는 값은 UTC로 해석한다.
 */
export function parseDbTime(value: unknown): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(text);
  const date = match ? new Date(`${match[1]}T${match[2]}Z`) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** <time datetime>·클라이언트 변환용 ISO 8601 UTC 문자열 */
export function toIsoUtc(value: unknown): string {
  const date = parseDbTime(value);
  return date ? date.toISOString() : '';
}

function getZonedParts(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const out: Record<string, string> = {};
  for (const part of parts) out[part.type] = part.value;
  return out;
}

/** 목록 시각: YYYY.MM.DD HH:MM (한국 시간) */
export function formatListTime(value: unknown): string {
  const date = parseDbTime(value);
  if (!date) return '';
  const parts = getZonedParts(date, DISPLAY_FALLBACK_TIME_ZONE);
  return `${parts.year}.${parts.month}.${parts.day} ${parts.hour}:${parts.minute}`;
}

/** 댓글 시각: 'YYYY년 M월 D일 HH:MM' (한국 시간) */
export function formatCommentDateTime(value: unknown): string {
  const date = parseDbTime(value);
  if (!date) return '';
  return date.toLocaleString('ko-KR', {
    timeZone: DISPLAY_FALLBACK_TIME_ZONE,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

export function isEditedAfterCreate(createdAt: unknown, updatedAt: unknown): boolean {
  const created = parseDbTime(createdAt);
  const updated = parseDbTime(updatedAt);
  if (!created || !updated) return false;
  return updated.getTime() - created.getTime() > EDITED_THRESHOLD_MS;
}

/** 목록 제목 한 줄 최대 글자 수 (넘으면 말줄임) */
const LIST_TITLE_MAX = 30;
const LIST_TITLE_ELLIPSIS = '......';
/** 메인·게시판 목록의 게시판 이름 한 줄 최대 글자 수 */
const LIST_BOARD_NAME_MAX = 10;
const LIST_BOARD_ELLIPSIS = '...';
/** 전체 게시물 목록(/posts)은 게시판 칸이 넓어 20자까지 */
export const LIST_BOARD_NAME_ALL_POSTS_MAX = 20;

export function truncatePostTitleLine(value: unknown, maxLength = LIST_TITLE_MAX): string {
  const text = value != null && String(value).trim() !== '' ? String(value).trim() : '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + LIST_TITLE_ELLIPSIS;
}

export function truncateBoardNameLine(value: unknown, maxLength = LIST_BOARD_NAME_MAX): string {
  const text = value != null && String(value).trim() !== '' ? String(value).trim() : '';
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + LIST_BOARD_ELLIPSIS;
}

export type PageItem = { type: 'page'; page: number; isCurrent: boolean } | { type: 'ellipsis' };

/** 페이지가 이 수 이하면 번호를 모두 보이고, 넘으면 앞뒤 일부만 보이고 말줄임 */
const PAGINATION_SHOW_ALL_MAX = 11;
/** 많을 때 현재 페이지 앞뒤로 보여 줄 번호 수 */
const PAGINATION_NEIGHBORS = 2;

export function buildPaginationItems(current: number, total: number): PageItem[] {
  if (total <= 1) return [{ type: 'page', page: 1, isCurrent: current === 1 }];
  const items: PageItem[] = [];
  const pushPage = (page: number) => items.push({ type: 'page', page, isCurrent: page === current });
  if (total <= PAGINATION_SHOW_ALL_MAX) {
    for (let i = 1; i <= total; i += 1) pushPage(i);
    return items;
  }
  const pushEllipsis = () => {
    if (items.length && items[items.length - 1].type !== 'ellipsis') items.push({ type: 'ellipsis' });
  };
  // 첫 페이지와 마지막 페이지는 항상 보이므로, 가운데 구간은 2 ~ (total - 1) 안에서 고른다.
  pushPage(1);
  const left = Math.max(2, current - PAGINATION_NEIGHBORS);
  const right = Math.min(total - 1, current + PAGINATION_NEIGHBORS);
  if (left > 2) pushEllipsis();
  for (let i = left; i <= right; i += 1) pushPage(i);
  if (right < total - 1) pushEllipsis();
  pushPage(total);
  return items;
}

/**
 * 쿼리로 받는 페이지 번호 상한: 100만 (실제 페이지 수보다 넉넉하게 정한 값).
 * 너무 큰 값은 OFFSET 계산이 안전한 정수 범위를 넘어 D1 쿼리가 실패하므로 미리 자른다.
 */
const PAGE_PARAM_MAX = 1_000_000;

/** 쿼리의 page 값 → 1 ~ PAGE_PARAM_MAX 정수 (숫자가 아니면 1). 범위를 넘는 페이지는 라우트가 마지막 페이지로 다시 보낸다. */
export function parsePageParam(value: string | undefined): number {
  return Math.min(PAGE_PARAM_MAX, Math.max(1, parseInt(value ?? '', 10) || 1));
}

/** 전체 개수 → 페이지 수 (0개여도 1페이지) */
export function countPages(total: number, pageSize: number): number {
  return total === 0 ? 1 : Math.ceil(total / pageSize);
}
