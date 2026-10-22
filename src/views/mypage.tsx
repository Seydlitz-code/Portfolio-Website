/** 마이페이지 (기존 views/mypage-account.ejs와 partials/mypage-* 이식) */
import { InlineScript, Layout } from './layout';
import { BoardPagination, TopNav, type NavData } from './nav';
import { ColorPicker, FontFamilyOptions } from './post';
import { escapeJsonForScript } from '../lib/html';
import type { PagerItem } from '../lib/mypageWritings';
import type { PageItem } from '../lib/time';
import { DEFAULT_SITE_NAME, type Settings } from '../lib/siteData';

type MypageTab = 'profile' | 'posts' | 'mainSettings' | 'boardsManage';

export type ProfileUser = { id: number; username: string; nickname: string; avatar: string | null };

export type MyPostRow = {
  id: number;
  title: string;
  title_ja: string | null;
  project_name: string | null;
  project_name_ja: string | null;
  comment_count: number;
  created_iso: string;
  created_display: string;
};

export type MyCommentRow = {
  id: number;
  post_id: number;
  post_title: string;
  post_title_ja: string | null;
  preview_text: string;
  is_preview_two_line: boolean;
  created_iso: string;
  created_display: string;
};

export type BoardRow = {
  id: number;
  name: string;
  name_ja: string | null;
  description: string | null;
  post_count: number;
};

type Common = {
  nav: NavData;
  headerNickname: string;
  profileUser: ProfileUser;
  isAdmin: boolean;
};

type ProfileTabProps = Common & {
  tab: 'profile';
  /** 폼에 보여 줄 닉네임 (오류 재표시 때는 입력값) */
  formNickname: string;
  initialNickname: string;
  isSaved: boolean;
  profileError: string | null;
  /** 닉네임을 바꿨는데 중복 확인을 하지 않은 경우 */
  isNicknameUnverified: boolean;
};

type PostsTabProps = Common & {
  tab: 'posts';
  myPosts: MyPostRow[];
  myPostsTotal: number;
  myPostsPager: PagerItem[];
  myComments: MyCommentRow[];
  myCommentsTotal: number;
  myCommentsPager: PagerItem[];
  writingsNext: string;
};

type MainSettingsTabProps = Common & {
  tab: 'mainSettings';
  settings: Settings;
  isSaved: boolean;
  errorMessage: string | null;
};

type BoardsTabProps = Common & {
  tab: 'boardsManage';
  boardsList: BoardRow[];
  boardsAllPostsCount: number;
  page: number;
  totalPages: number;
  paginationItems: PageItem[];
  flags: { isCreated: boolean; isDeleted: boolean; isEdited: boolean; hasEditError: boolean };
};

type MypageProps = ProfileTabProps | PostsTabProps | MainSettingsTabProps | BoardsTabProps;

function Alert({ kind, children }: { kind: 'success' | 'error'; children: unknown }) {
  return (
    <div class="mypage-account-alert">
      <div class={`alert alert-${kind}`}>{children as string}</div>
    </div>
  );
}

function AccountNav({ tab, isAdmin }: { tab: MypageTab; isAdmin: boolean }) {
  const renderNavItem = (navTab: MypageTab, href: string, label: string) => (
    <a href={href} class={`mypage-account-nav-item${tab === navTab ? ' is-active' : ''}`}>
      {label}
    </a>
  );
  return (
    <nav class="mypage-account-nav" aria-label="마이페이지 하위 메뉴">
      {renderNavItem('profile', '/mypage', '프로필')}
      {renderNavItem('posts', '/mypage/posts', '작성한 글 보기')}
      {isAdmin && renderNavItem('mainSettings', '/mypage/main-settings', '메인 페이지 설정')}
      {isAdmin && renderNavItem('boardsManage', '/mypage/boards', '게시판 생성&삭제')}
    </nav>
  );
}

function WritingsPager({ pager, aria }: { pager: PagerItem[]; aria: string }) {
  if (!pager.length) return null;
  return (
    <nav class="mypage-writings-pager" aria-label={aria}>
      {pager.map((item) => {
        if (item.kind === 'prev' || item.kind === 'next') {
          return item.isDisabled || !item.href ? (
            <span class="mypage-writings-pager-link is-disabled" aria-disabled="true">
              {item.label}
            </span>
          ) : (
            <a class="mypage-writings-pager-link" href={item.href} rel={item.kind}>
              {item.label}
            </a>
          );
        }
        if (item.kind === 'ellipsis') {
          return (
            <span class="mypage-writings-pager-ellipsis" aria-hidden="true">
              …
            </span>
          );
        }
        return item.kind === 'page' && item.isCurrent ? (
          <span class="mypage-writings-pager-page is-current" aria-current="page">
            {item.label}
          </span>
        ) : (
          <a class="mypage-writings-pager-page" href={item.href ?? undefined}>
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

function ProfileTab(props: ProfileTabProps) {
  const avatar = props.profileUser.avatar;
  return (
    <>
      {props.isSaved && <Alert kind="success">적용이 완료되었습니다.</Alert>}
      {props.profileError && <Alert kind="error">{props.profileError}</Alert>}

      <div class="mypage-profile-head">
        <h2 class="mypage-profile-section-title">프로필 설정 및 변경</h2>
        <button type="submit" form="mypageAccountForm" class="btn-primary mypage-account-apply" id="mypageAccountApply" disabled>
          적용하기
        </button>
      </div>

      <form id="mypageAccountForm" class="mypage-account-form" action="/mypage/profile" method="post" enctype="multipart/form-data">
        <div class="mypage-profile-avatar-block">
          <div class="mypage-profile-avatar-preview-wrap">
            <img
              src={avatar || ''}
              alt=""
              class={`mypage-profile-avatar-img${avatar ? '' : ' is-hidden'}`}
              id="mypageAccountAvatarImg"
              width={160}
              height={160}
              decoding="async"
            />
            <div
              class={`mypage-profile-avatar-placeholder${avatar ? ' is-hidden' : ''}`}
              id="mypageAccountAvatarPlaceholder"
              aria-hidden="true"
            >
              {props.formNickname ? Array.from(props.formNickname)[0] : '?'}
            </div>
          </div>
          <div class="mypage-profile-avatar-side">
            <p class="mypage-profile-avatar-label">프로필 이미지 설정</p>
            <input type="file" id="mypageAccountAvatarFile" name="avatar" accept="image/jpeg,image/png,image/gif,image/webp" hidden />
            <button type="button" class="register-avatar-select-btn" id="mypageAccountBtnSelectAvatar">
              이미지 선택
            </button>
          </div>
        </div>

        <div class="form-group mypage-profile-nick-group">
          <label class="form-label" for="mypageAccountNickname">
            닉네임 <span class="required">*</span>
          </label>
          <div class="register-input-line">
            <input
              type="text"
              id="mypageAccountNickname"
              name="nickname"
              class="form-input"
              required
              maxlength={20}
              autocomplete="nickname"
              value={props.formNickname}
            />
          </div>
          <div class="register-dup-btn-row">
            <button type="button" class="nav-btn register-dup-btn" id="mypageAccountBtnCheckNick">
              닉네임 중복 확인
            </button>
          </div>
          <small id="mypageAccountNickHint" class="form-hint register-field-hint" aria-live="polite">
            닉네임을 수정한 경우 「닉네임 중복 확인」을 누른 뒤 적용해 주세요.
          </small>
          {props.isNicknameUnverified ? (
            <p class="mypage-nick-warn" id="mypageAccountNickWarn" role="alert">
              닉네임 중복 확인을 해주세요.
            </p>
          ) : (
            <p class="mypage-nick-warn is-hidden" id="mypageAccountNickWarn" role="alert"></p>
          )}
        </div>
      </form>
    </>
  );
}

function PostsTab(props: PostsTabProps) {
  const titleSeparator = (
    <span class="mypage-writings-title-sep" aria-hidden="true">
      {' '}/{' '}
    </span>
  );
  return (
    <div class="mypage-writings">
      {props.isAdmin && (
        <section class="mypage-writings-block" aria-labelledby="mypageWritingsPostsTitle">
          <h2 class="mypage-writings-title" id="mypageWritingsPostsTitle">
            작성한 게시물 ({props.myPostsTotal})
          </h2>
          <div class="mypage-writings-divider" role="presentation"></div>
          {props.myPosts.length === 0 ? (
            <>
              <p class="mypage-writings-empty-plain" id="myPostsEmpty">
                작성한 게시글이 없습니다.
              </p>
              <ul class="mypage-writings-list is-hidden" id="myPostsList" aria-label="게시글 목록"></ul>
            </>
          ) : (
            <div class="mypage-writings-panel mypage-writings-panel--cards">
              <ul class="mypage-writings-list mypage-writings-list--stacked" id="myPostsList">
                {props.myPosts.map((post) => {
                  const ko = String(post.title || '').trim();
                  const ja = post.title_ja != null ? String(post.title_ja).trim() : '';
                  const boardName = post.project_name && post.project_name.trim() ? post.project_name.trim() : '분류 없음';
                  const boardNameJa = post.project_name_ja && post.project_name_ja.trim() ? post.project_name_ja.trim() : '未分類';
                  return (
                    <li class="mypage-writings-card mypage-writings-card--post">
                      <div class="mypage-writings-row-top">
                        <a href={`/posts/${post.id}`} class="mypage-writings-heading-link">
                          <span class="mypage-writings-title-ko">{ko}</span>
                          {ja !== '' && (
                            <>
                              {titleSeparator}
                              <span class="mypage-writings-title-ja" lang="ja">
                                {ja}
                              </span>
                            </>
                          )}
                          <span class="mypage-writings-meta-bracket">[{post.comment_count}]</span>
                        </a>
                      </div>
                      <div class="mypage-writings-row-bottom">
                        <div class="mypage-writings-bottom-left">
                          <span class="mypage-writings-board-line">
                            <span>{boardName}</span>
                            {titleSeparator}
                            <span lang="ja">{boardNameJa}</span>
                          </span>
                          <time class="mypage-writings-bottom-time" datetime={post.created_iso} data-local-time="list">
                            {post.created_display}
                          </time>
                        </div>
                        <form
                          action={`/posts/${post.id}?_method=DELETE`}
                          method="post"
                          class="mypage-comment-delete-form mypage-writings-delete-form"
                          onsubmit="return confirm('정말로 삭제하시겠습니까?');"
                        >
                          <input type="hidden" name="next" value={props.writingsNext} />
                          <button type="submit" class="mypage-comment-delete-btn" aria-label="게시글 삭제">
                            삭제
                          </button>
                        </form>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <WritingsPager pager={props.myPostsPager} aria="작성한 게시물 페이지" />
            </div>
          )}
        </section>
      )}

      <section class="mypage-writings-block" aria-labelledby="mypageWritingsCommentsTitle">
        <h2 class="mypage-writings-title" id="mypageWritingsCommentsTitle">
          댓글 ({props.myCommentsTotal})
        </h2>
        <div class="mypage-writings-divider" role="presentation"></div>
        {props.myComments.length === 0 ? (
          <>
            <p class="mypage-writings-empty-plain" id="myCommentsEmpty">
              작성한 댓글이 없습니다.
            </p>
            <ul class="mypage-writings-list is-hidden" id="myCommentsList" aria-label="댓글 목록"></ul>
          </>
        ) : (
          <div class="mypage-writings-panel mypage-writings-panel--cards">
            <ul class="mypage-writings-list mypage-writings-list--stacked" id="myCommentsList">
              {props.myComments.map((comment) => {
                const postTitle = String(comment.post_title || '').trim();
                const postTitleJa = comment.post_title_ja != null ? String(comment.post_title_ja).trim() : '';
                return (
                  <li class="mypage-writings-card mypage-writings-card--comment">
                    <div class="mypage-writings-row-top">
                      <p class={comment.is_preview_two_line ? 'mypage-writings-comment-preview is-clamp-2' : 'mypage-writings-comment-preview'}>
                        {comment.preview_text}
                      </p>
                      <time class="mypage-writings-row-time" datetime={comment.created_iso} data-local-time="list">
                        {comment.created_display}
                      </time>
                    </div>
                    <div class="mypage-writings-row-bottom">
                      <a href={`/posts/${comment.post_id}#comments`} class="mypage-writings-post-ref">
                        <span class="mypage-writings-title-ko">{postTitle}</span>
                        {postTitleJa !== '' && (
                          <>
                            {titleSeparator}
                            <span class="mypage-writings-title-ja" lang="ja">
                              {postTitleJa}
                            </span>
                          </>
                        )}
                      </a>
                      <form
                        action={`/posts/${comment.post_id}/comments/${comment.id}?_method=DELETE`}
                        method="post"
                        class="mypage-comment-delete-form mypage-writings-delete-form"
                        onsubmit="return confirm('정말로 삭제하시겠습니까?');"
                      >
                        <input type="hidden" name="next" value={props.writingsNext} />
                        <button type="submit" class="mypage-comment-delete-btn" aria-label="댓글 삭제">
                          삭제
                        </button>
                      </form>
                    </div>
                  </li>
                );
              })}
            </ul>
            <WritingsPager pager={props.myCommentsPager} aria="작성한 댓글 페이지" />
          </div>
        )}
      </section>
    </div>
  );
}

function FormatToolbar({ idSuffix }: { idSuffix: string }) {
  return (
    <div
      class="post-editor-toolbar post-editor-toolbar--format mypage-main-fmt-toolbar"
      id={`mypageFmtBar${idSuffix}`}
      role="toolbar"
      aria-label="글자 서식"
    >
      <select id={`mypageFmtFontFamily${idSuffix}`} class="post-editor-fmt-select" title="글꼴" aria-label="글꼴">
        <FontFamilyOptions />
      </select>
      <span class="post-editor-fmt-div" aria-hidden="true"></span>
      <button type="button" class="post-editor-fmt-btn" data-cmd="bold" title="굵게 (Ctrl+B)">
        <i class="fas fa-bold" aria-hidden="true"></i>
      </button>
      <button type="button" class="post-editor-fmt-btn" data-cmd="underline" title="밑줄 (Ctrl+U)">
        <i class="fas fa-underline" aria-hidden="true"></i>
      </button>
      <button type="button" class="post-editor-fmt-btn" data-cmd="strikeThrough" title="취소선">
        <i class="fas fa-strikethrough" aria-hidden="true"></i>
      </button>
      <span class="post-editor-fmt-div" aria-hidden="true"></span>
      <ColorPicker
        buttonId={`mypageFmtColorBtn${idSuffix}`}
        panelId={`mypageFmtColorPanel${idSuffix}`}
        backgroundGridId={`mypageFmtBgGrid${idSuffix}`}
        foregroundGridId={`mypageFmtFgGrid${idSuffix}`}
        foregroundHiddenId={`mypageFmtFgColorHidden${idSuffix}`}
        backgroundHiddenId={`mypageFmtBgColorHidden${idSuffix}`}
      />
    </div>
  );
}

function MainSettingsTab(props: MainSettingsTabProps) {
  const profileImageUrl = props.settings.profile_image;
  return (
    <>
      {props.isSaved && <Alert kind="success">적용이 완료되었습니다.</Alert>}
      {props.errorMessage && <Alert kind="error">{props.errorMessage}</Alert>}

      <div class="mypage-profile-head">
        <h2 class="mypage-profile-section-title">메인 페이지 설정</h2>
        <button type="submit" form="mypageMainSettingsForm" class="btn-primary mypage-account-apply">
          적용하기
        </button>
      </div>

      <form id="mypageMainSettingsForm" class="mypage-account-form" action="/admin/apply" method="post" enctype="multipart/form-data">
        <section class="mypage-main-settings-hero">
          <div class="mypage-main-settings-avatar-col">
            <div class="profile-circle-wrap mypage-main-settings-circle">
              <img id="mypageMainProfilePreview" class="profile-img" alt="" src={profileImageUrl || ''} style={profileImageUrl ? '' : 'display:none'} />
              <div class="profile-placeholder" id="mypageMainNoImg" style={profileImageUrl ? 'display:none' : 'display:flex'}>
                <i class="fas fa-user" aria-hidden="true"></i>
                <span class="placeholder-hint">프로필 이미지</span>
              </div>
            </div>
            <input type="file" name="profile_image" id="mypageMainFileInput" accept="image/jpeg,image/png,image/gif,image/webp" hidden />
            <button type="button" class="register-avatar-select-btn" id="mypageMainBtnSelectImage">
              이미지 선택
            </button>
          </div>
          <div class="mypage-main-settings-fields">
            <div class="form-group">
              <span class="form-label" id="mypageMainSiteNameLabel">
                메인 페이지 표기 이름
              </span>
              <div class="mypage-rich-stack" id="mypageRichStackSn" aria-labelledby="mypageMainSiteNameLabel">
                <FormatToolbar idSuffix="Sn" />
                <div
                  id="mypageEditorSn"
                  class="post-editor-body mypage-main-rich-body mypage-main-rich-body--site"
                  contenteditable={true}
                  spellcheck={true}
                  role="textbox"
                  aria-multiline="true"
                  aria-labelledby="mypageMainSiteNameLabel"
                  data-placeholder="표기 이름을 입력하세요."
                ></div>
                <input type="hidden" name="site_name" id="mypageHiddenSn" class="mypage-main-rich-hidden" value="" aria-hidden="true" />
              </div>
            </div>
            <div class="form-group">
              <span class="form-label" id="mypageMainBioLabel">
                자기소개 · 이력
              </span>
              <div class="mypage-rich-stack" id="mypageRichStackBio" aria-labelledby="mypageMainBioLabel">
                <FormatToolbar idSuffix="Bio" />
                <div
                  id="mypageEditorBio"
                  class="post-editor-body mypage-main-rich-body mypage-main-rich-body--bio"
                  contenteditable={true}
                  spellcheck={true}
                  role="textbox"
                  aria-multiline="true"
                  aria-labelledby="mypageMainBioLabel"
                  data-placeholder="내용을 입력하세요."
                ></div>
                <input type="hidden" name="bio" id="mypageHiddenBio" class="mypage-main-rich-hidden" value="" aria-hidden="true" />
              </div>
            </div>
          </div>
        </section>
      </form>
    </>
  );
}

function BoardsTab(props: BoardsTabProps) {
  return (
    <>
      {props.flags.isCreated && <Alert kind="success">게시판이 생성되었습니다.</Alert>}
      {props.flags.isDeleted && <Alert kind="success">게시판이 삭제되었습니다.</Alert>}
      {props.flags.isEdited && <Alert kind="success">게시판 정보가 수정되었습니다.</Alert>}
      {props.flags.hasEditError && <Alert kind="error">게시판 수정에 실패했습니다. 필수 항목을 확인해 주세요.</Alert>}

      <div class="mypage-boards-head">
        <h2 class="mypage-profile-section-title mypage-boards-head-title">게시판 전체 보기</h2>
        <div class="mypage-boards-head-actions">
          <button type="button" class="admin-action-btn admin-action-btn--outline" onclick="openCreateBoardModal()">
            <i class="fas fa-folder-plus"></i> 게시판 생성하기
          </button>
        </div>
      </div>

      <div class="board-table-wrap mypage-boards-table-wrap" role="region" aria-label="게시판 목록">
        <table class="board-table mypage-boards-table">
          <thead>
            <tr>
              <th class="board-th mypage-boards-th-title" scope="col">게시판</th>
              <th class="board-th mypage-boards-th-count" scope="col">게시물 수</th>
              <th class="board-th mypage-boards-th-actions" scope="col">수정·삭제</th>
            </tr>
          </thead>
          <tbody>
            <tr class="board-row board-row--all-posts">
              <td class="board-td mypage-boards-td-title">
                <a href="/posts" class="board-title-link board-title-link--all-posts">
                  전체 게시물{' '}
                  <span class="board-title-sep" aria-hidden="true">
                    /
                  </span>{' '}
                  <span lang="ja">すべての投稿</span>
                </a>
              </td>
              <td class="board-td mypage-boards-td-count">{props.boardsAllPostsCount}</td>
              <td class="board-td mypage-boards-td-actions">
                <div class="mypage-boards-action-cell" role="group" aria-label="전체 게시물 관리">
                  <a href="/posts" class="mypage-boards-edit" aria-label="전체 게시물 수정·관리">
                    <i class="fas fa-pen" aria-hidden="true"></i>
                    <span class="mypage-boards-edit-label">수정하기</span>
                  </a>
                  <span class="mypage-boards-no-del" aria-hidden="true">
                    —
                  </span>
                </div>
              </td>
            </tr>
            {props.boardsList.length === 0 ? (
              <tr>
                <td class="board-td board-td--empty" colspan={3}>
                  등록된 게시판이 없습니다.
                </td>
              </tr>
            ) : (
              props.boardsList.map((board) => {
                const label = (board.name || '') + (board.name_ja ? ' / ' + board.name_ja : '');
                return (
                  <tr class="board-row">
                    <td class="board-td mypage-boards-td-title">
                      <a href={`/boards/${board.id}`} class="board-title-link">
                        {board.name}
                        {board.name_ja && <> / {board.name_ja}</>}
                      </a>
                    </td>
                    <td class="board-td mypage-boards-td-count">{board.post_count}</td>
                    <td class="board-td mypage-boards-td-actions">
                      <div class="mypage-boards-action-cell" role="group" aria-label={`${label} 관리`}>
                        <button
                          type="button"
                          class="mypage-boards-edit"
                          data-board-edit={String(board.id)}
                          data-name={encodeURIComponent(board.name || '')}
                          data-name-ja={encodeURIComponent(board.name_ja || '')}
                          data-description={encodeURIComponent(board.description || '')}
                          aria-label={`${label} 수정`}
                        >
                          <i class="fas fa-pen" aria-hidden="true"></i>
                          <span class="mypage-boards-edit-label">수정하기</span>
                        </button>
                        <button
                          type="button"
                          class="mypage-boards-trash"
                          data-board-delete={String(board.id)}
                          data-post-count={String(board.post_count)}
                          aria-label={`${label} 삭제`}
                        >
                          <i class="fas fa-trash-alt" aria-hidden="true"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <BoardPagination
        page={props.page}
        totalPages={props.totalPages}
        items={props.paginationItems}
        href={(n) => `/mypage/boards?page=${n}`}
        navClass="mypage-boards-pagination"
        ariaLabel="게시판 목록 페이지"
      />

      <form id="mypageBoardDeleteForm" method="post" action="" style="display:none">
        <input type="hidden" name="_method" value="DELETE" />
      </form>

      <div id="createBoardModal" class="modal-overlay" style="display:none" onclick="closeModalOnOverlay(event, 'createBoardModal')">
        <div class="modal-box modal-box--boards-create" onclick="event.stopPropagation()">
          <button type="button" class="mypage-boards-modal-back" onclick="closeCreateBoardModal()">
            뒤로 가기
          </button>
          <h3 class="mypage-boards-modal-title">게시판 생성하기</h3>
          <p id="createBoardFormError" class="mypage-boards-form-error" role="alert"></p>
          <form id="createBoardForm" action="/admin/projects" method="post">
            <div class="form-group">
              <label class="form-label" for="createBoardNameKo">
                게시판 이름 입력 (국문) <span class="required">*</span>
              </label>
              <input type="text" id="createBoardNameKo" name="name" class="form-input" maxlength={120} autocomplete="off" />
            </div>
            <div class="form-group">
              <label class="form-label" for="createBoardNameJa">
                게시판 이름 입력 (일본어) <span class="required">*</span>
              </label>
              <input type="text" id="createBoardNameJa" name="name_ja" class="form-input" maxlength={120} autocomplete="off" />
            </div>
            <div class="form-group">
              <label class="form-label" for="createBoardDesc">
                게시판에 대한 간단한 소개문 <span class="required">*</span>
              </label>
              <textarea id="createBoardDesc" name="description" class="form-input" rows={4} maxlength={2000}></textarea>
            </div>
            <div class="mypage-boards-modal-submit-wrap">
              <button type="submit" class="btn-primary mypage-boards-submit-wide">
                게시판 생성하기
              </button>
            </div>
          </form>
        </div>
      </div>

      <div id="editBoardModal" class="modal-overlay" style="display:none" onclick="closeModalOnOverlay(event, 'editBoardModal')">
        <div class="modal-box modal-box--boards-create modal-box--boards-edit" onclick="event.stopPropagation()">
          <button type="button" class="mypage-boards-modal-back" onclick="closeEditBoardModal()">
            <span class="mypage-boards-modal-back-icon" aria-hidden="true">
              ←
            </span>{' '}
            뒤로 가기
          </button>
          <h3 class="mypage-boards-modal-title">게시판 수정하기</h3>
          <p id="editBoardFormError" class="mypage-boards-form-error" role="alert"></p>
          <form id="editBoardForm" method="post" action="">
            <input type="hidden" name="_method" value="PUT" />
            <div class="mypage-boards-edit-fields">
              <div class="form-group">
                <label class="form-label" for="editBoardNameKo">
                  게시판 이름 입력 (국문)
                </label>
                <input
                  type="text"
                  id="editBoardNameKo"
                  name="name"
                  class="form-input"
                  maxlength={120}
                  autocomplete="off"
                  placeholder="국문 게시판 이름을 입력하세요"
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="editBoardNameJa">
                  게시판 이름 입력 (일본어)
                </label>
                <input
                  type="text"
                  id="editBoardNameJa"
                  name="name_ja"
                  class="form-input"
                  maxlength={120}
                  autocomplete="off"
                  placeholder="日本語の掲示板名を入力してください"
                />
              </div>
              <div class="form-group">
                <label class="form-label" for="editBoardDesc">
                  게시판에 대한 간단한 소개문
                </label>
                <textarea
                  id="editBoardDesc"
                  name="description"
                  class="form-input"
                  rows={4}
                  maxlength={2000}
                  placeholder="게시판 소개문을 입력하세요"
                ></textarea>
              </div>
            </div>
            <div class="mypage-boards-modal-actions" role="group" aria-label="게시판 수정">
              <button type="button" class="mypage-boards-modal-btn mypage-boards-modal-btn--ghost" onclick="closeEditBoardModal()">
                취소
              </button>
              <button type="submit" class="mypage-boards-modal-btn mypage-boards-modal-btn--solid">
                게시판 수정하기
              </button>
            </div>
          </form>
        </div>
      </div>

      <div
        id="boardDeleteConfirmModal"
        class="modal-overlay"
        style="display:none"
        onclick="closeModalOnOverlay(event, 'boardDeleteConfirmModal')"
      >
        <div class="modal-box modal-box--narrow" onclick="event.stopPropagation()">
          <h3 class="modal-header" style="border:none;padding:0;margin:0 0 1rem;font-size:1.1rem">
            삭제하시겠습니까?
          </h3>
          <p class="mypage-account-muted" style="margin-bottom:1.25rem">
            삭제한 게시판은 복구할 수 없습니다.
          </p>
          <div class="modal-actions" style="justify-content:flex-end;gap:0.5rem">
            <button type="button" class="btn-secondary" onclick="closeBoardDeleteConfirm()">
              취소
            </button>
            <button type="button" class="btn-primary" style="background:#b91c1c;border-color:#b91c1c" onclick="confirmBoardDeleteSubmit()">
              삭제
            </button>
          </div>
        </div>
      </div>

      <div
        id="boardDeleteBlockedModal"
        class="modal-overlay"
        style="display:none"
        onclick="closeModalOnOverlay(event, 'boardDeleteBlockedModal')"
      >
        <div class="modal-box modal-box--narrow" onclick="event.stopPropagation()">
          <h3 class="modal-header" style="border:none;padding:0;margin:0 0 1rem;font-size:1.05rem">
            삭제할 수 없음
          </h3>
          <p class="mypage-account-muted" style="margin-bottom:1.25rem">
            게시판에 게시물이 존재해 게시판을 삭제할 수 없습니다.
          </p>
          <div class="modal-actions" style="justify-content:flex-end">
            <button type="button" class="btn-primary" onclick="closeBoardDeleteBlocked()">
              확인
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export function MypagePage(props: MypageProps) {
  const initialNickname = props.tab === 'profile' ? props.initialNickname : props.profileUser.nickname;
  const scripts: (string | { src: string; defer?: boolean })[] = ['/js/mypage-account.js'];
  if (props.tab === 'mainSettings') scripts.push('/js/mypage-main-settings-rich.js', '/js/mypage-main-settings.js');
  if (props.tab === 'boardsManage') scripts.push('/js/mypage-boards.js');
  scripts.push({ src: '/js/local-time.js', defer: true });

  return (
    <Layout
      title="마이페이지 — 포트폴리오"
      bodyClass="mypage-account-page"
      hasIcons={props.isAdmin && (props.tab === 'boardsManage' || props.tab === 'mainSettings')}
      scripts={scripts}
    >
      <TopNav nav={props.nav} shouldCenterHome />

      <div class="mypage-account-layout">
        <aside class="mypage-account-sidebar" aria-label="마이페이지 메뉴">
          <div class="mypage-account-sidebar-inner">
            <p class="mypage-account-sidebar-label">마이페이지</p>
            <AccountNav tab={props.tab} isAdmin={props.isAdmin} />
          </div>
        </aside>

        <div class="mypage-account-stage">
          <header class="mypage-account-stage-header">
            <h1 class="mypage-account-title">
              {props.headerNickname} / @{props.profileUser.username}
            </h1>
          </header>

          <main class="mypage-account-main">
            {props.tab === 'profile' && <ProfileTab {...props} />}
            {props.tab === 'posts' && <PostsTab {...props} />}
            {props.tab === 'mainSettings' && <MainSettingsTab {...props} />}
            {props.tab === 'boardsManage' && <BoardsTab {...props} />}
          </main>
        </div>
      </div>

      <InlineScript
        code={`window.__MYPAGE_ACCOUNT__ = ${escapeJsonForScript({
          initialNickname,
          initialAvatar: props.profileUser.avatar || null,
          activeTab: props.tab
        })};`}
      />
      {props.tab === 'mainSettings' && (
        <InlineScript
          code={`window.__MYPAGE_MAIN_SETTINGS__ = ${escapeJsonForScript({
            site_name: props.settings.site_name ? props.settings.site_name : DEFAULT_SITE_NAME,
            bio: props.settings.bio ? props.settings.bio : '',
            profile_image: props.settings.profile_image ? props.settings.profile_image : ''
          })};`}
        />
      )}
    </Layout>
  );
}
