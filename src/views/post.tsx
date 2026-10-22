/** 게시물 상세·작성 폼 (기존 views/post.ejs, partials/comment-item.ejs, post-form.ejs 이식) */
import { Layout, RawHtml } from './layout';
import { InnerHeader, type NavData } from './nav';
import type { Project } from '../lib/siteData';

export type PostDetail = {
  id: number;
  title: string;
  title_ja: string | null;
  project_id: number | null;
  project_name: string | null;
  project_name_ja: string | null;
  project_description: string | null;
  author_nickname: string | null;
  view_count: number;
};

export type CommentView = {
  id: number;
  user_id: number;
  nickname: string | null;
  avatarUrl: string;
  content: string;
  display_time_iso: string;
  display_time_suffix: string;
  display_time_line: string;
};

/** 값이 있고 공백만이 아닌지 */
const hasText = (value: string | null | undefined) => value != null && String(value).trim() !== '';

function CommentItem({ comment, postId, nav }: { comment: CommentView; postId: number; nav: NavData }) {
  const canEdit = nav.user != null && nav.user.id === comment.user_id;
  const canDelete = canEdit || nav.isAdmin;
  return (
    <div class="comment-block">
      <div class="comment-top">
        <div class="comment-avatar-wrap">
          <img
            src={comment.avatarUrl}
            alt=""
            class="comment-avatar"
            width={44}
            height={44}
            decoding="async"
            loading="lazy"
            onerror="this.onerror=null;this.src='/images/default-profile.svg';"
          />
        </div>
        <div class="comment-meta">
          <span class="comment-author">{comment.nickname}</span>
          <time
            class="comment-date"
            datetime={comment.display_time_iso}
            data-local-time="comment"
            data-suffix={comment.display_time_suffix}
          >
            {comment.display_time_line}
          </time>
        </div>
      </div>
      <div class="comment-view" id={`comment-view-${comment.id}`}>
        <p class="comment-body">{comment.content}</p>
      </div>
      <div class="comment-footer">
        <div class="comment-actions-links">
          {canEdit && (
            <button type="button" class="comment-link comment-edit-open" data-comment-id={String(comment.id)}>
              수정
            </button>
          )}
          {canDelete && (
            <form
              action={`/posts/${postId}/comments/${comment.id}?_method=DELETE`}
              method="post"
              class="comment-delete-form"
              onsubmit="return confirm('댓글을 삭제하시겠습니까?');"
            >
              <button type="submit" class="comment-link comment-link--danger">
                삭제
              </button>
            </form>
          )}
        </div>
      </div>
      {canEdit && (
        <form
          id={`comment-edit-${comment.id}`}
          action={`/posts/${postId}/comments/${comment.id}?_method=PUT`}
          method="post"
          class="comment-edit-form is-hidden"
          autocomplete="off"
        >
          <textarea name="content" class="comment-textarea comment-textarea--edit" rows={3} maxlength={100} required>
            {comment.content}
          </textarea>
          <div class="comment-edit-actions">
            <button type="submit" class="btn-primary btn-primary--sm">
              저장
            </button>
            <button type="button" class="btn-secondary btn-secondary--sm comment-edit-cancel" data-comment-id={String(comment.id)}>
              취소
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function PostPage(props: {
  nav: NavData;
  post: PostDetail;
  contentHtml: string;
  isContentHtml: boolean;
  createdIso: string;
  createdDisplay: string;
  updatedIso: string;
  updatedDisplay: string;
  isEdited: boolean;
  comments: CommentView[];
}) {
  const { nav, post, comments } = props;
  const titleJa = hasText(post.title_ja) ? String(post.title_ja).trim() : '';
  const count = comments.length;
  const newPostQuery = post.project_id
    ? `?project_id=${post.project_id}&cancel=${encodeURIComponent('/posts/' + post.id)}`
    : `?cancel=${encodeURIComponent('/posts/' + post.id)}`;

  return (
    <Layout
      title={`${post.title}${titleJa ? ' / ' + titleJa : ''} — 포트폴리오`}
      bodyClass="inner-page post-detail-page"
      hasIcons
      scripts={[
        { src: '/js/local-time.js', defer: true },
        { src: '/js/post-detail.js', defer: true }
      ]}
    >
      <InnerHeader nav={nav} />

      <main class="inner-main post-detail-main">
        <div class={`inner-container post-container${props.isContentHtml ? ' post-container--wide' : ''}`}>
          <article class="post-article">
            <header class="post-board-head">
              {post.project_id && post.project_name ? (
                <>
                  <a href={`/boards/${post.project_id}`} class="post-board-name post-board-name--ko">
                    {post.project_name}
                  </a>
                  {hasText(post.project_name_ja) && (
                    <a href={`/boards/${post.project_id}`} class="post-board-name post-board-name--ja" lang="ja">
                      {post.project_name_ja}
                    </a>
                  )}
                </>
              ) : (
                <>
                  <span class="post-board-name post-board-name--ko">분류 없음</span>
                  <span class="post-board-name post-board-name--ja" lang="ja">
                    未分類
                  </span>
                </>
              )}
            </header>
            <div class="post-board-rule" aria-hidden="true"></div>

            <h1 class="post-heading-title">{post.title}</h1>
            {hasText(post.title_ja) && (
              <p class="post-heading-title post-heading-title--ja" lang="ja">
                {post.title_ja}
              </p>
            )}

            <div class="post-meta-row">
              <div class="post-meta-left">
                <span class="post-meta-author">{hasText(post.author_nickname) ? post.author_nickname : '—'}</span>
                <span class="post-meta-times">
                  작성{' '}
                  <time datetime={props.createdIso} data-local-time="list">
                    {props.createdDisplay}
                  </time>
                  {props.isEdited && (
                    <>
                      <span class="post-meta-sep">·</span>
                      수정{' '}
                      <time datetime={props.updatedIso} data-local-time="list">
                        {props.updatedDisplay}
                      </time>
                      <span class="post-edited-pill">(수정됨)</span>
                    </>
                  )}
                </span>
              </div>
              <div class="post-meta-right">
                <span class="post-view-count" aria-label="조회수">
                  조회 {post.view_count}
                </span>
                <button
                  type="button"
                  class="post-comment-jump"
                  id="postCommentJumpBtn"
                  aria-label={`댓글 ${count}개, 댓글 영역으로 이동`}
                >
                  댓글 {count}
                </button>
              </div>
            </div>

            <div class={`post-content${props.isContentHtml ? ' post-content--html' : ''}`}>
              <RawHtml html={props.contentHtml} />
            </div>

            {nav.isAdmin && (
              <div class="post-admin-actions">
                <a href={`/posts/${post.id}/edit`} class="btn-secondary">
                  <i class="fas fa-pen"></i> 수정
                </a>
                <form
                  action={`/posts/${post.id}?_method=DELETE`}
                  method="post"
                  class="post-admin-delete-form"
                  onsubmit="return confirm('게시물을 삭제하시겠습니까?')"
                >
                  <button type="submit" class="btn-danger">
                    <i class="fas fa-trash"></i> 삭제
                  </button>
                </form>
                <button type="button" class="btn-secondary" id="postWriteGuideBtn">
                  <i class="fas fa-pen-nib"></i> 글쓰기
                </button>
              </div>
            )}
          </article>

          <section class="comments-section" id="comments">
            <h2 class="comments-title">
              댓글 <span class="comments-title-count">({count})</span>
            </h2>

            {count === 0 ? (
              <p class="no-comments">아직 댓글이 없습니다. 첫 댓글을 남겨보세요!</p>
            ) : (
              <div class="comments-list">
                {comments.map((c) => (
                  <div class="comment-item">
                    <CommentItem comment={c} postId={post.id} nav={nav} />
                  </div>
                ))}
              </div>
            )}

            {nav.user ? (
              <form action={`/posts/${post.id}/comments`} method="post" class="comment-form" id="mainCommentForm">
                <div class="comment-form-header">
                  <span class="comment-form-user">{nav.user.nickname}으로 댓글 작성</span>
                  <span class="comment-char-count" id="commentCharCount" aria-live="polite">
                    0 / 100
                  </span>
                </div>
                <textarea
                  name="content"
                  id="commentMainTextarea"
                  class="comment-textarea"
                  rows={3}
                  maxlength={100}
                  placeholder="댓글을 입력하세요... (최대 100자)"
                  required
                ></textarea>
                <button type="submit" class="btn-primary">
                  댓글 등록
                </button>
              </form>
            ) : (
              <div class="comment-login-prompt">
                <p>
                  댓글을 작성하려면 <a href={`/auth/login?next=/posts/${post.id}`}>로그인</a>이 필요합니다.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>

      {nav.isAdmin && (
        <dialog id="postWriteGuideDialog" class="post-write-guide-dialog">
          <div class="post-write-guide-inner">
            <h2 class="post-write-guide-title">글쓰기 안내</h2>
            <p class="post-write-guide-title-ja" lang="ja">
              執筆のご案内
            </p>
            {post.project_id && post.project_name && (
              <p class="post-write-guide-board">
                <span class="post-write-guide-board-ko">{post.project_name}</span>
                {hasText(post.project_name_ja) && (
                  <span class="post-write-guide-board-ja" lang="ja">
                    {post.project_name_ja}
                  </span>
                )}
              </p>
            )}
            {hasText(post.project_description) && (
              <div class="post-write-guide-desc" lang="ko">
                {String(post.project_description).trim()}
              </div>
            )}
            <ul class="post-write-guide-list" lang="ko">
              <li>이 게시판 주제에 맞는 내용만 작성해 주세요.</li>
              <li>제목은 국문(필수)과 일본어를 함께 입력하는 것을 권장합니다.</li>
              <li>이미지·동영상은 저작권을 확인한 뒤 첨부해 주세요.</li>
            </ul>
            <ul class="post-write-guide-list post-write-guide-list--ja" lang="ja">
              <li>この掲示板のテーマに沿った内容でお書きください。</li>
              <li>タイトルは韓国語（必須）と日本語の併記を推奨します。</li>
              <li>画像・動画は著作権を確認のうえ添付してください。</li>
            </ul>
            <div class="post-write-guide-actions">
              <button type="button" class="btn-secondary" id="postWriteGuideClose">
                닫기
              </button>
              <a href={`/posts/new${newPostQuery}`} class="btn-primary">
                새 글 작성하기
              </a>
            </div>
          </div>
        </dialog>
      )}
    </Layout>
  );
}

const FONT_OPTIONS: [string, string][] = [
  ["'Noto Sans KR', 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif", '본고딕 (Noto Sans KR)'],
  ["'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif", '맑은 고딕'],
  ["'Batang', 'BatangChe', Georgia, 'Times New Roman', serif", '바탕·명조 계열'],
  ["Georgia, 'Times New Roman', 'Batang', serif", '명조 (Georgia)'],
  ["'Gulim', 'Dotum', 'Malgun Gothic', sans-serif", '굴림·돋움 계열'],
  ["ui-monospace, 'Consolas', 'Malgun Gothic', monospace", '고정폭']
];

export function FontFamilyOptions() {
  return (
    <>
      <option value="">글꼴</option>
      {FONT_OPTIONS.map(([v, label]) => (
        <option value={v}>{label}</option>
      ))}
    </>
  );
}

export type PostFormProps = {
  nav: NavData;
  /** 수정이면 대상 게시물, 새 글이면 null */
  post: { id: number; project_id: number | null } | null;
  projects: Project[];
  formAction: string;
  error?: string | null;
  cancelHref: string;
  defaultProjectId?: number | null;
  lockedProject?: Project | null;
  /** 에디터 초기값 (html, titleKo, titleJa) JSON의 base64 */
  editorInitBase64: string;
  titleKo: string;
  titleJa: string;
};

export function PostFormPage(props: PostFormProps) {
  const { nav, post, projects } = props;
  const locked = !post && props.lockedProject ? props.lockedProject : null;
  return (
    <Layout
      title={`${post ? '게시물 수정' : '새 게시물 작성'} — ${nav.siteTitle || '포트폴리오'}`}
      bodyClass="inner-page post-editor-page"
      hasIcons
      scripts={[{ src: '/js/post-editor.js', defer: true }]}
    >
      <InnerHeader nav={nav} />

      <main class="post-editor-main">
        <div class="post-editor-shell">
          <header class="post-editor-page-head">
            <a href="/posts" class="post-editor-backlink">
              전체 게시물 보기
            </a>
            <p class="post-editor-backlink-ja" lang="ja">
              全ての投稿を表示
            </p>
            <div class="post-editor-head-rule" aria-hidden="true"></div>
          </header>

          {props.error && <div class="post-editor-alert">{props.error}</div>}

          <form id="postEditorForm" action={props.formAction} method="post" class="post-editor-form">
            {!post && <input type="hidden" name="_cancel_href" value={props.cancelHref} />}
            <div class="post-editor-title-grid">
              <label class="post-editor-field">
                <span class="post-editor-label">
                  제목을 입력해주세요 (국문) <span class="required">*</span>
                </span>
                <input
                  type="text"
                  name="title"
                  id="postTitleKo"
                  class="post-editor-input"
                  value={props.titleKo}
                  placeholder="국문 제목"
                  autocomplete="off"
                  required
                />
              </label>
              <label class="post-editor-field">
                <span class="post-editor-label">제목을 입력해주세요 (일본어)</span>
                <input
                  type="text"
                  name="title_ja"
                  id="postTitleJa"
                  class="post-editor-input"
                  value={props.titleJa}
                  placeholder="日本語タイトル"
                  lang="ja"
                  autocomplete="off"
                />
              </label>
            </div>

            <div class="post-editor-field post-editor-field--inline">
              <span class="post-editor-label">
                게시판{!post && <> <span class="required">*</span></>}
              </span>
              {locked ? (
                <>
                  <input type="hidden" name="_project_form_locked" value="1" />
                  <input type="hidden" name="project_id" value={String(locked.id)} />
                  <p class="post-editor-readonly-board" id="postProjectReadonly">
                    {locked.name}
                    {hasText(locked.name_ja) && (
                      <>
                        {' '}
                        <span class="post-editor-readonly-board-ja" lang="ja">
                          ({locked.name_ja})
                        </span>
                      </>
                    )}
                  </p>
                </>
              ) : (
                <select name="project_id" id="postProjectId" class="post-editor-select" required={!post}>
                  {!post ? (
                    <option value="" disabled selected={props.defaultProjectId == null}>
                      게시판을 선택하세요
                    </option>
                  ) : (
                    <option value="" selected={!post.project_id}>
                      -- 분류 없음 --
                    </option>
                  )}
                  {projects.map((p) => (
                    <option
                      value={String(p.id)}
                      selected={post ? post.project_id === p.id : props.defaultProjectId === p.id}
                    >
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div class="post-editor-toolbars">
              <div class="post-editor-toolbar post-editor-toolbar--media" role="toolbar" aria-label="미디어 삽입">
                <button type="button" class="post-editor-toolbtn" id="postEditorBtnImage" title="이미지">
                  <i class="fas fa-image" aria-hidden="true"></i>
                  <span>이미지</span>
                </button>
                <button type="button" class="post-editor-toolbtn" id="postEditorBtnVideo" title="동영상">
                  <i class="fas fa-film" aria-hidden="true"></i>
                  <span>동영상</span>
                </button>
                <button type="button" class="post-editor-toolbtn" id="postEditorBtnYoutube" title="YouTube">
                  <i class="fab fa-youtube" aria-hidden="true"></i>
                  <span>YouTube</span>
                </button>
                <input
                  type="file"
                  id="postEditorFileImage"
                  class="is-hidden"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  tabindex={-1}
                  aria-hidden="true"
                />
                <input
                  type="file"
                  id="postEditorFileVideo"
                  class="is-hidden"
                  accept="video/mp4,video/webm,video/quicktime"
                  tabindex={-1}
                  aria-hidden="true"
                />
              </div>

              <div class="post-editor-toolbar post-editor-toolbar--format" role="toolbar" aria-label="글자 서식">
                <select id="postEditorFontFamily" class="post-editor-fmt-select" title="글꼴" aria-label="글꼴">
                  <FontFamilyOptions />
                </select>
                <div class="post-editor-fmt-size-wrap" id="postEditorFontSizeWrap">
                  <button
                    type="button"
                    id="postEditorFontSizeTrigger"
                    class="post-editor-fmt-size-trigger"
                    aria-haspopup="listbox"
                    aria-expanded="false"
                    title="글자 크기 (px)"
                    aria-label="글자 크기 선택"
                  >
                    <span class="post-editor-fmt-size-trigger-value" id="postEditorFontSizeValue">
                      10
                    </span>
                    <i class="fas fa-chevron-down post-editor-fmt-size-trigger-chevron" aria-hidden="true"></i>
                  </button>
                  <div id="postEditorFontSizeMenu" class="post-editor-fmt-size-menu is-hidden" role="listbox" aria-label="글자 크기"></div>
                </div>
                <span class="post-editor-fmt-div" aria-hidden="true"></span>
                <button type="button" class="post-editor-fmt-btn" data-cmd="bold" title="굵게 (Ctrl+B)">
                  <i class="fas fa-bold" aria-hidden="true"></i>
                </button>
                <button type="button" class="post-editor-fmt-btn" data-cmd="italic" title="기울임 (Ctrl+I)">
                  <i class="fas fa-italic" aria-hidden="true"></i>
                </button>
                <button type="button" class="post-editor-fmt-btn" data-cmd="underline" title="밑줄 (Ctrl+U)">
                  <i class="fas fa-underline" aria-hidden="true"></i>
                </button>
                <button type="button" class="post-editor-fmt-btn" data-cmd="strikeThrough" title="취소선">
                  <i class="fas fa-strikethrough" aria-hidden="true"></i>
                </button>
                <span class="post-editor-fmt-div" aria-hidden="true"></span>
                <ColorPicker
                  buttonId="postEditorColorBtn"
                  panelId="postEditorColorPanel"
                  backgroundGridId="postEditorBgGrid"
                  foregroundGridId="postEditorFgGrid"
                  foregroundHiddenId="postEditorFgColorHidden"
                  backgroundHiddenId="postEditorBgColorHidden"
                />
                <span class="post-editor-fmt-div" aria-hidden="true"></span>
                <button type="button" class="post-editor-fmt-btn" data-justify="left" title="왼쪽 정렬">
                  <i class="fas fa-align-left" aria-hidden="true"></i>
                </button>
                <button type="button" class="post-editor-fmt-btn" data-justify="center" title="가운데 정렬">
                  <i class="fas fa-align-center" aria-hidden="true"></i>
                </button>
                <button type="button" class="post-editor-fmt-btn" data-justify="right" title="오른쪽 정렬">
                  <i class="fas fa-align-right" aria-hidden="true"></i>
                </button>
              </div>
            </div>

            <div
              id="postEditorBody"
              class="post-editor-body"
              contenteditable={true}
              spellcheck={true}
              data-placeholder="게시물 본문을 입력하세요. 이미지·동영상은 버튼으로 추가하거나 붙여넣기·드래그 앤 드롭할 수 있습니다."
            ></div>
            <textarea id="postContentHidden" name="content" class="is-hidden" aria-hidden="true" tabindex={-1}></textarea>

            <div class="post-editor-actions">
              <a href={post ? `/posts/${post.id}` : props.cancelHref} class="post-editor-btn post-editor-btn--ghost">
                취소
              </a>
              <button type="submit" class="post-editor-btn post-editor-btn--primary">
                {post ? '수정 완료' : '등록'}
              </button>
            </div>
          </form>
        </div>
      </main>

      <dialog id="postYtDialog" class="post-editor-dialog">
        <div class="post-editor-dialog-inner">
          <h2 class="post-editor-dialog-title">YouTube 링크</h2>
          <p class="post-editor-dialog-hint">영상 URL을 붙여넣은 뒤 적용을 누르면 본문에 플레이어와 링크가 함께 들어갑니다.</p>
          <input type="url" id="postYtInput" class="post-editor-input" placeholder="https://www.youtube.com/watch?v=…" />
          <div class="post-editor-dialog-actions">
            <button type="button" class="post-editor-btn post-editor-btn--ghost" id="postYtCancel">
              닫기
            </button>
            <button type="button" class="post-editor-btn post-editor-btn--primary" id="postYtApply">
              적용
            </button>
          </div>
        </div>
      </dialog>

      <input type="hidden" id="post-editor-init-b64" value={props.editorInitBase64} />
    </Layout>
  );
}

/** 글자·배경 색 선택 (게시물 에디터·마이페이지 서식 도구 공통) */
export function ColorPicker(props: {
  buttonId: string;
  panelId: string;
  backgroundGridId: string;
  foregroundGridId: string;
  foregroundHiddenId: string;
  backgroundHiddenId: string;
}) {
  return (
    <div class="post-editor-color-wrap">
      <button
        type="button"
        id={props.buttonId}
        class="post-editor-fmt-color post-editor-fmt-color--trigger"
        title="글자·배경 색"
        aria-label="글자·배경 색"
        aria-expanded="false"
        aria-haspopup="dialog"
      >
        <span class="post-editor-fmt-color-bar" aria-hidden="true"></span>
        <i class="fas fa-font" aria-hidden="true"></i>
      </button>
      <div id={props.panelId} class="post-editor-color-panel is-hidden" role="dialog" aria-label="색 선택">
        <div class="post-editor-color-col">
          <span class="post-editor-color-col-title">배경색</span>
          <button type="button" class="post-editor-color-preset" data-color-action="bg-transparent">
            투명으로 설정
          </button>
          <div id={props.backgroundGridId} class="post-editor-swatch-grid"></div>
          <button type="button" class="post-editor-color-more" data-color-more="bg">
            다른 색상 선택
          </button>
        </div>
        <div class="post-editor-color-col">
          <span class="post-editor-color-col-title">글자색</span>
          <button type="button" class="post-editor-color-preset" data-color-action="fg-black">
            검은색으로 설정
          </button>
          <div id={props.foregroundGridId} class="post-editor-swatch-grid"></div>
          <button type="button" class="post-editor-color-more" data-color-more="fg">
            다른 색상 선택
          </button>
        </div>
      </div>
      <input
        type="color"
        id={props.foregroundHiddenId}
        class="post-editor-color-native"
        value="#000000"
        aria-hidden="true"
        tabindex={-1}
        title="글자색 직접 선택"
      />
      <input
        type="color"
        id={props.backgroundHiddenId}
        class="post-editor-color-native"
        value="#ffffff"
        aria-hidden="true"
        tabindex={-1}
        title="배경색 직접 선택"
      />
    </div>
  );
}
