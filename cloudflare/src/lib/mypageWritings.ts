/** 마이페이지 '작성한 글 보기' 보조 (기존 lib/mypageWritings.js 이식) */
import { buildPaginationItems } from './time';

export function writingsListUrl(postPage: number, commentPage: number): string {
  const p = Math.max(1, Math.floor(postPage) || 1);
  const c = Math.max(1, Math.floor(commentPage) || 1);
  const sp = new URLSearchParams();
  if (p > 1) sp.set('postPage', String(p));
  if (c > 1) sp.set('commentPage', String(c));
  const q = sp.toString();
  return q ? `/mypage/posts?${q}` : '/mypage/posts';
}

/** 비관리자(댓글만): commentPage 쿼리만 사용 */
export function writingsCommentsOnlyUrl(commentPage: number): string {
  const c = Math.max(1, Math.floor(commentPage) || 1);
  return c <= 1 ? '/mypage/posts' : `/mypage/posts?commentPage=${c}`;
}

/** 게시물·댓글 삭제 후 돌아갈 next 값 화이트리스트 검증 */
export function sanitizeMypageWritingsNext(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'string') return null;
  const t = raw.trim();
  if (t.includes('\r') || t.includes('\n')) return null;
  if (!t.startsWith('/mypage/posts') || t.startsWith('//')) return null;
  if (t === '/mypage/posts') return t;
  const q = t.indexOf('?');
  if (q === -1 || t.slice(0, q) !== '/mypage/posts') return null;
  const sp = new URLSearchParams(t.slice(q + 1));
  for (const k of sp.keys()) if (k !== 'postPage' && k !== 'commentPage') return null;
  const pp = sp.get('postPage');
  const cp = sp.get('commentPage');
  if (pp != null && (!/^\d+$/.test(pp) || parseInt(pp, 10) < 1)) return null;
  if (cp != null && (!/^\d+$/.test(cp) || parseInt(cp, 10) < 1)) return null;
  return t;
}

/** 20자 이상이면 20글자 후 말줄임, 그 미만은 2줄 clamp용 원문 */
export function commentPreviewParts(content: unknown): { previewText: string; previewTwoLine: boolean } {
  const normalized = String(content ?? '').replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(normalized);
  const previewText =
    chars.length >= 20 ? chars.slice(0, 20).join('') + (chars.length > 20 ? '…' : '') : normalized;
  return { previewText, previewTwoLine: chars.length < 20 };
}

export type PagerItem =
  | { kind: 'prev' | 'next'; label: string; href: string | null; disabled: boolean }
  | { kind: 'page'; label: string; href: string; current: boolean }
  | { kind: 'ellipsis' };

export function buildWritingsPager(currentPage: number, totalPages: number, href: (n: number) => string): PagerItem[] {
  const total = Math.max(1, Number(totalPages) || 1);
  const cur = Math.max(1, Math.min(currentPage, total));
  const items: PagerItem[] = [
    { kind: 'prev', label: '이전', href: cur > 1 ? href(cur - 1) : null, disabled: cur <= 1 }
  ];
  for (const p of buildPaginationItems(cur, total)) {
    if (p.type === 'ellipsis') items.push({ kind: 'ellipsis' });
    else items.push({ kind: 'page', label: String(p.n), href: href(p.n), current: p.current });
  }
  items.push({ kind: 'next', label: '다음', href: cur < total ? href(cur + 1) : null, disabled: cur >= total });
  return items;
}
