/** 마이페이지 '작성한 글 보기' 보조: 페이지 주소, 삭제 후 돌아갈 경로 검증, 댓글 미리보기 (기존 lib/mypageWritings.js 이식) */
import { buildPaginationItems } from './time';

const WRITINGS_PATH = '/mypage/posts';
/** 댓글 미리보기 길이: 이 글자 수 이상이면 잘라서 말줄임, 미만이면 두 줄로 보여 준다 */
const COMMENT_PREVIEW_CHARS = 20;

export function buildWritingsListUrl(postPage: number, commentPage: number): string {
  const safePostPage = Math.max(1, Math.floor(postPage) || 1);
  const safeCommentPage = Math.max(1, Math.floor(commentPage) || 1);
  const searchParams = new URLSearchParams();
  if (safePostPage > 1) searchParams.set('postPage', String(safePostPage));
  if (safeCommentPage > 1) searchParams.set('commentPage', String(safeCommentPage));
  const query = searchParams.toString();
  return query ? `${WRITINGS_PATH}?${query}` : WRITINGS_PATH;
}

/** 비관리자(댓글만): commentPage 쿼리만 쓴다 */
export function buildWritingsCommentsOnlyUrl(commentPage: number): string {
  const safeCommentPage = Math.max(1, Math.floor(commentPage) || 1);
  return safeCommentPage <= 1 ? WRITINGS_PATH : `${WRITINGS_PATH}?commentPage=${safeCommentPage}`;
}

const isPositiveIntegerText = (value: string | null) => value == null || (/^\d+$/.test(value) && parseInt(value, 10) >= 1);

/** 게시물·댓글 삭제 후 돌아갈 next 값 검증: /mypage/posts와 그 페이지 쿼리만 허용한다 */
export function sanitizeMypageWritingsNext(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'string') return null;
  const path = raw.trim();
  if (path.includes('\r') || path.includes('\n')) return null;
  if (!path.startsWith(WRITINGS_PATH) || path.startsWith('//')) return null;
  if (path === WRITINGS_PATH) return path;
  const queryStart = path.indexOf('?');
  if (queryStart === -1 || path.slice(0, queryStart) !== WRITINGS_PATH) return null;
  const searchParams = new URLSearchParams(path.slice(queryStart + 1));
  for (const name of searchParams.keys()) if (name !== 'postPage' && name !== 'commentPage') return null;
  if (!isPositiveIntegerText(searchParams.get('postPage')) || !isPositiveIntegerText(searchParams.get('commentPage'))) return null;
  return path;
}

export function buildCommentPreview(content: unknown): { previewText: string; isPreviewTwoLine: boolean } {
  const normalized = String(content ?? '').replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(normalized);
  const isLong = chars.length >= COMMENT_PREVIEW_CHARS;
  const previewText = isLong
    ? chars.slice(0, COMMENT_PREVIEW_CHARS).join('') + (chars.length > COMMENT_PREVIEW_CHARS ? '…' : '')
    : normalized;
  return { previewText, isPreviewTwoLine: !isLong };
}

export type PagerItem =
  | { kind: 'prev' | 'next'; label: string; href: string | null; isDisabled: boolean }
  | { kind: 'page'; label: string; href: string; isCurrent: boolean }
  | { kind: 'ellipsis' };

/** 이전·번호·다음 버튼 목록 */
export function buildWritingsPager(currentPage: number, totalPages: number, buildHref: (page: number) => string): PagerItem[] {
  const total = Math.max(1, Number(totalPages) || 1);
  const current = Math.max(1, Math.min(currentPage, total));
  const items: PagerItem[] = [
    { kind: 'prev', label: '이전', href: current > 1 ? buildHref(current - 1) : null, isDisabled: current <= 1 }
  ];
  for (const item of buildPaginationItems(current, total)) {
    if (item.type === 'ellipsis') items.push({ kind: 'ellipsis' });
    else items.push({ kind: 'page', label: String(item.page), href: buildHref(item.page), isCurrent: item.isCurrent });
  }
  items.push({ kind: 'next', label: '다음', href: current < total ? buildHref(current + 1) : null, isDisabled: current >= total });
  return items;
}
