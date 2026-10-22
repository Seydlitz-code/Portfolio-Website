/** 전체 게시물(/posts)·게시판(/boards/:id) 목록 (기존 views/posts.ejs, board.ejs 이식) */
import { Layout } from './layout';
import { BoardPagination, InnerHeader, type NavData } from './nav';
import { TitleCells } from './home';
import type { ListPost, Project } from '../lib/siteData';
import type { PageItem } from '../lib/time';

type ListProps = {
  nav: NavData;
  posts: ListPost[];
  page: number;
  totalPages: number;
  paginationItems: PageItem[];
};

function EmptyRow({ columnCount }: { columnCount: number }) {
  return (
    <tr>
      <td class="board-td board-td--empty" colspan={columnCount}>
        게시물이 존재하지 않습니다.
      </td>
    </tr>
  );
}

export function AllPostsPage(props: ListProps & { introKo: string; introJa: string }) {
  const { nav } = props;
  return (
    <Layout
      title={`전체 게시물 — ${nav.siteTitle || '포트폴리오'}`}
      bodyClass="inner-page posts-all-page"
      hasIcons
      scripts={[{ src: '/js/local-time.js', defer: true }]}
    >
      <InnerHeader nav={nav} />
      <main class="inner-main posts-all-main">
        <div class="posts-all-shell">
          <div class={`board-list-header-zone${nav.isAdmin ? ' board-list-header-zone--has-toolbar' : ''}`}>
            <header class="posts-all-heading posts-all-heading--split">
              <div class="posts-all-titles">
                <h1 class="posts-all-title-ko">전체 게시물</h1>
                <p class="posts-all-title-ja" lang="ja">
                  すべての投稿
                </p>
              </div>
              <div class="posts-all-intro" lang="ko">
                <p class="posts-all-intro-line">{props.introKo}</p>
                <p class="posts-all-intro-line posts-all-intro-line--ja" lang="ja">
                  {props.introJa}
                </p>
              </div>
            </header>
            {nav.isAdmin && (
              <div class="board-list-admin-toolbar">
                <a href="/posts/new" class="admin-action-btn">
                  <i class="fas fa-plus"></i> 새 게시물 작성
                </a>
              </div>
            )}
          </div>

          <div class="board-table-wrap posts-all-table-wrap" role="region" aria-label="전체 게시글 목록">
            <table class="board-table posts-all-table">
              <thead>
                <tr>
                  <th class="board-th board-th--num" scope="col">번호</th>
                  <th class="board-th board-th--board" scope="col">게시판</th>
                  <th class="board-th board-th--title" scope="col">제목</th>
                  <th class="board-th board-th--author" scope="col">작성자</th>
                  <th class="board-th board-th--date" scope="col">작성일</th>
                  <th class="board-th board-th--views" scope="col">조회수</th>
                  <th class="board-th board-th--comments" scope="col">댓글</th>
                </tr>
              </thead>
              <tbody>
                {props.posts.length === 0 ? (
                  <EmptyRow columnCount={7} />
                ) : (
                  props.posts.map((post) => (
                    <tr class="board-row">
                      <td class="board-td board-td--num">{post.global_num}</td>
                      <td class="board-td board-td--board">
                        {post.project_id ? (
                          <a href={`/boards/${post.project_id}`} class="board-board-link">
                            <span class="board-title-line board-title-line--ko">{post.project_name_ko_short}</span>
                            <span class="board-title-line board-title-line--ja" lang="ja">
                              {post.project_name_ja_short || '　'}
                            </span>
                          </a>
                        ) : (
                          <span class="board-board-static">—</span>
                        )}
                      </td>
                      <TitleCells post={post} />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <BoardPagination
            page={props.page}
            totalPages={props.totalPages}
            items={props.paginationItems}
            href={(n) => `/posts?page=${n}`}
            navClass="posts-all-pagination"
          />
        </div>
      </main>
    </Layout>
  );
}

export function BoardPage(props: ListProps & { project: Project }) {
  const { nav, project } = props;
  const description = project.description ? String(project.description).trim() : '';
  return (
    <Layout
      title={`${project.name} — ${nav.siteTitle || '포트폴리오'}`}
      bodyClass="inner-page board-page"
      hasIcons
      scripts={[{ src: '/js/local-time.js', defer: true }]}
    >
      <InnerHeader nav={nav} />
      <main class="inner-main board-main">
        <div class="board-page-shell">
          <div class={`board-list-header-zone${nav.isAdmin ? ' board-list-header-zone--has-toolbar' : ''}`}>
            <header class="board-page-heading board-page-heading--split">
              <div class="board-page-titles">
                <h1 class="board-page-title">{project.name}</h1>
                {project.name_ja && (
                  <p class="board-page-title-ja" lang="ja">
                    {project.name_ja}
                  </p>
                )}
              </div>
              {description && (
                <p class="board-page-intro" lang="ko">
                  {description}
                </p>
              )}
            </header>
            {nav.isAdmin && (
              <div class="board-list-admin-toolbar">
                <a
                  href={`/posts/new?project_id=${project.id}&cancel=${encodeURIComponent('/boards/' + project.id)}`}
                  class="admin-action-btn"
                >
                  <i class="fas fa-plus"></i> 새 게시물 작성
                </a>
              </div>
            )}
          </div>

          <div class="board-table-wrap" role="region" aria-label="게시글 목록">
            <table class="board-table">
              <thead>
                <tr>
                  <th class="board-th board-th--num" scope="col">번호</th>
                  <th class="board-th board-th--title" scope="col">제목</th>
                  <th class="board-th board-th--author" scope="col">작성자</th>
                  <th class="board-th board-th--date" scope="col">작성일</th>
                  <th class="board-th board-th--views" scope="col">조회수</th>
                  <th class="board-th board-th--comments" scope="col">댓글</th>
                </tr>
              </thead>
              <tbody>
                {props.posts.length === 0 ? (
                  <EmptyRow columnCount={6} />
                ) : (
                  props.posts.map((post) => (
                    <tr class="board-row">
                      <td class="board-td board-td--num">{post.global_num}</td>
                      <TitleCells post={post} />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <BoardPagination
            page={props.page}
            totalPages={props.totalPages}
            items={props.paginationItems}
            href={(n) => `/boards/${project.id}?page=${n}`}
          />
        </div>
      </main>
    </Layout>
  );
}
