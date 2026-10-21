/** 메인 화면 (기존 views/index.ejs 이식) */
import { Layout, RawHtml } from './layout';
import { TopNav, type NavData } from './nav';
import type { ListPost, Project } from '../lib/siteData';

function RecentRow({ post }: { post: ListPost }) {
  return (
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
  );
}

/** 제목·작성자·작성일·조회수·댓글 칸 (목록 화면 공통) */
export function TitleCells({ post }: { post: ListPost }) {
  return (
    <>
      <td class="board-td board-td--title">
        <div class="board-title-stack">
          <a href={`/posts/${post.id}`} class="board-title-link board-title-line board-title-line--ko">
            {post.title_ko_short}
          </a>
          <span class="board-title-line board-title-line--ja" lang="ja">
            {post.title_ja_short || '　'}
          </span>
        </div>
      </td>
      <td class="board-td board-td--author">{post.author_nickname || '—'}</td>
      <td class="board-td board-td--date">
        <time datetime={post.created_at_iso} data-local-time="list">
          {post.display_time}
        </time>
      </td>
      <td class="board-td board-td--views">{post.view_count}</td>
      <td class="board-td board-td--comments">{post.comment_count}</td>
    </>
  );
}

export function HomePage(props: {
  nav: NavData;
  siteNameHtml: string;
  bioHtml: string;
  profileImage: string;
  recentPosts: ListPost[];
  projects: (Project & { posts: ListPost[] })[];
}) {
  return (
    <Layout
      title={props.nav.siteTitle || 'Donghawan Lee / @lilip'}
      htmlClass="index-scroll-snap"
      bodyClass="index-page"
      icons
      scripts={['/js/main.js', { src: '/js/local-time.js', defer: true }]}
    >
      <TopNav nav={props.nav} indexHeroLink />

      <section id="hero" class="hero-section">
        <div class="hero-content">
          <div class="profile-area">
            <div class="profile-circle-wrap">
              {props.profileImage ? (
                <img src={props.profileImage} alt="프로필 이미지" class="profile-img" />
              ) : (
                <div class="profile-placeholder">
                  <i class="fas fa-user"></i>
                  <span class="placeholder-hint">프로필 이미지</span>
                </div>
              )}
            </div>
          </div>

          <div class="hero-info">
            <h1 class="hero-name">
              <RawHtml html={props.siteNameHtml || 'Donghawan Lee / @lilip'} />
            </h1>
            <div class="hero-bio-wrap">
              {props.bioHtml.replace(/\s/g, '').length > 0 && (
                <div class="hero-bio">
                  <RawHtml html={props.bioHtml} />
                </div>
              )}
            </div>
            <div class="social-links">
              <a href="https://github.com/Seydlitz-code" target="_blank" rel="noopener" class="social-btn" title="GitHub">
                <i class="fab fa-github"></i>
              </a>
              <a
                href="https://www.linkedin.com/in/%EB%8F%99%ED%99%98-%EC%9D%B4-aa7443369/"
                target="_blank"
                rel="noopener"
                class="social-btn"
                title="LinkedIn"
              >
                <i class="fab fa-linkedin-in"></i>
              </a>
              <a href="https://x.com/lilip_seydlitz" target="_blank" rel="noopener" class="social-btn" title="Twitter / X">
                <i class="fab fa-x-twitter"></i>
              </a>
            </div>
          </div>
        </div>

        <div class="scroll-down-hint" onclick="scrollToPortfolio(event)">
          <span>스크롤하여 포트폴리오 보기</span>
          <i class="fas fa-chevron-down bounce"></i>
        </div>
      </section>

      <main id="portfolio" class="portfolio-section">
        <div class="portfolio-body">
          <section class="portfolio-block">
            <div class="block-header block-header--centered">
              <div class="block-title-group">
                <h2 class="block-title">
                  <a href="/posts" class="block-title-link">
                    전체 게시물 보기
                  </a>
                </h2>
                <a href="/posts" class="block-title-link block-title-ja">
                  全ての投稿を表示
                </a>
              </div>
            </div>
            <div class="portfolio-block-posts">
              <div class="board-table-wrap index-portfolio-table-wrap" role="region" aria-label="전체 최근 게시글">
                <table class="board-table posts-all-table index-home-recent-table">
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
                    {props.recentPosts.length === 0 ? (
                      <tr>
                        <td class="board-td board-td--empty" colspan={7}>
                          게시물이 존재하지 않습니다.
                        </td>
                      </tr>
                    ) : (
                      props.recentPosts.map((post) => <RecentRow post={post} />)
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {props.projects.map((project) => (
            <section class="portfolio-block">
              <div class="block-header block-header--centered">
                <div class="block-title-group">
                  <h2 class="block-title">
                    <a href={`/boards/${project.id}`} class="block-title-link">
                      {project.name}
                    </a>
                  </h2>
                  {project.name_ja && (
                    <a href={`/boards/${project.id}`} class="block-title-link block-title-ja">
                      {project.name_ja}
                    </a>
                  )}
                </div>
              </div>
              <div class="portfolio-block-posts">
                <div
                  class="board-table-wrap index-portfolio-table-wrap"
                  role="region"
                  aria-label={`${project.name} 대표 게시글`}
                >
                  <table class="board-table index-home-board-table">
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
                      {project.posts.length === 0 ? (
                        <tr>
                          <td class="board-td board-td--empty" colspan={6}>
                            게시물이 존재하지 않습니다.
                          </td>
                        </tr>
                      ) : (
                        project.posts.map((post) => (
                          <tr class="board-row">
                            <td class="board-td board-td--num">{post.global_num}</td>
                            <TitleCells post={post} />
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ))}
        </div>
      </main>
    </Layout>
  );
}
