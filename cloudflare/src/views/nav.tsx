/** 상단 메뉴 (기존 partials/topnav.ejs, inner-header.ejs, nav-cluster.ejs 이식) */
import type { SessionUser } from '../types';
import { DEFAULT_SITE_NAME } from '../lib/siteData';
import type { PageItem } from '../lib/time';

/** 화면마다 메뉴에 필요한 값 */
export type NavData = {
  user: SessionUser | null;
  isAdmin: boolean;
  unreadCount: number;
  /** 사이트 이름(일반 텍스트) */
  siteTitle: string;
  mypageActive?: boolean;
};

export function NavCluster({ nav }: { nav: NavData }) {
  const { user } = nav;
  return (
    <div class="nav-cluster">
      {user ? (
        <div class="nav-user-chip">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt=""
              class="nav-user-avatar"
              width={32}
              height={32}
              decoding="async"
              loading="lazy"
            />
          ) : (
            <span class="nav-user-avatar nav-user-avatar--placeholder" aria-hidden="true">
              {user.nickname ? Array.from(user.nickname)[0] : '?'}
            </span>
          )}
          <span class="nav-nickname" title="닉네임">
            {user.nickname}
          </span>
        </div>
      ) : (
        <span class="nav-nickname" title="닉네임">
          <span class="nav-nickname-mute" aria-label="로그인 전">
            —
          </span>
        </span>
      )}
      {nav.isAdmin && user && (
        <div class="nav-notify-wrap" id="navNotifyWrap">
          <button
            type="button"
            class="nav-notify-btn"
            id="navNotifyBtn"
            aria-expanded="false"
            aria-haspopup="dialog"
            aria-controls="navNotifyPanel"
            aria-label="댓글 알림 열기"
          >
            <span class="nav-notify-icon" aria-hidden="true">
              <i class="fa-regular fa-bell"></i>
            </span>
            {nav.unreadCount > 0 && (
              <span class="nav-notify-dot" aria-label={`안 읽은 알림 ${nav.unreadCount}건`}></span>
            )}
          </button>
          <div id="navNotifyPanel" class="nav-notify-panel is-hidden" role="dialog" aria-label="알림" aria-modal="false" hidden>
            <div class="nav-notify-panel-inner">
              <div class="nav-notify-panel-head">
                <h2 class="nav-notify-title">알림</h2>
                <button type="button" class="nav-notify-read-all" id="navNotifyReadAll">
                  모두 읽음
                </button>
              </div>
              <div class="nav-notify-loading is-hidden" id="navNotifyLoading">
                불러오는 중…
              </div>
              <div class="nav-notify-empty is-hidden" id="navNotifyEmpty">
                새 알림이 없습니다.
              </div>
              <ul class="nav-notify-list" id="navNotifyList" role="list"></ul>
            </div>
          </div>
          <script src="/js/nav-notifications.js" defer></script>
        </div>
      )}
      <div class="nav-actions">
        {!user ? (
          <>
            <a href="/auth/login" class="nav-btn">
              로그인
            </a>
            <a href="/auth/register" class="nav-btn nav-btn-outline">
              회원가입
            </a>
          </>
        ) : (
          <>
            <a
              href="/mypage"
              class={`nav-btn nav-btn-outline${nav.mypageActive ? ' nav-btn-active' : ''}`}
              aria-current={nav.mypageActive ? 'page' : undefined}
            >
              마이페이지
            </a>
            <form action="/auth/logout" method="post" class="inline-form">
              <button type="submit" class="nav-btn">
                로그아웃
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export function TopNav({ nav, centerHome, indexHeroLink }: { nav: NavData; centerHome?: boolean; indexHeroLink?: boolean }) {
  const title = nav.siteTitle || DEFAULT_SITE_NAME;
  return (
    <nav class={`topnav ${centerHome ? 'topnav--center-home' : ''}`} id="topnav">
      <div
        class={`topnav-inner topnav-bar ${centerHome ? 'topnav-inner--center-home' : ''} ${
          indexHeroLink ? 'topnav-inner--index-home' : ''
        }`}
      >
        {centerHome && (
          <a href="/" class="topnav-home-link">
            {title}
          </a>
        )}
        {indexHeroLink && (
          <button
            type="button"
            class="topnav-index-home-btn"
            id="topnavIndexHomeBtn"
            onclick="scrollToHero(event)"
            aria-label="메인 화면으로 스크롤"
          >
            {title}
          </button>
        )}
        <div class="topnav-right topnav-right--cluster">
          <NavCluster nav={nav} />
        </div>
      </div>
    </nav>
  );
}

export function InnerHeader({ nav }: { nav: NavData }) {
  return (
    <header class="inner-header">
      <div class="inner-header-inner">
        <a href="/" class="inner-logo">
          {nav.siteTitle || DEFAULT_SITE_NAME}
        </a>
        <nav class="inner-nav inner-nav--cluster" aria-label="사용자 메뉴">
          <NavCluster nav={nav} />
        </nav>
      </div>
    </header>
  );
}

/** 목록 하단 페이지 번호 (posts.ejs, board.ejs, mypage 게시판 관리 공통) */
export function BoardPagination(props: {
  page: number;
  totalPages: number;
  items: PageItem[];
  href: (n: number) => string;
  navClass?: string;
  ariaLabel?: string;
}) {
  return (
    <nav class={`board-pagination${props.navClass ? ' ' + props.navClass : ''}`} aria-label={props.ariaLabel ?? '게시판 페이지'}>
      <p class="board-pagination-summary">
        전체 <strong>{props.totalPages}</strong>페이지 · 현재 <strong>{props.page}</strong>페이지
      </p>
      <div class="board-pagination-pages">
        {props.items.map((item) =>
          item.type === 'ellipsis' ? (
            <span class="board-page-ellipsis" aria-hidden="true">
              …
            </span>
          ) : item.current ? (
            <span class="board-page-num board-page-num--current" aria-current="page">
              {item.n}
            </span>
          ) : (
            <a class="board-page-num" href={props.href(item.n)}>
              {item.n}
            </a>
          )
        )}
      </div>
    </nav>
  );
}
