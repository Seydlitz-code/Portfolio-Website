/** 마이페이지: 프로필, 작성한 글, 메인 페이지 설정, 게시판 관리 (기존 routes/mypage.js 이식) */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { MypagePage, type BoardRow, type MyCommentRow, type MyPostRow } from '../views/mypage';
import { isFormBodyTooLarge, readField, readFileField, readForm, requireAdmin, requireLogin } from '../lib/http';
import { buildMypageShell, renderMainSettings } from '../lib/mypagePages';
import { buildSettingsStatements, getSiteSettings, parseSettingsResults } from '../lib/siteData';
import { buildPaginationItems, countPages, formatListTime, parsePageParam, toIsoUtc } from '../lib/time';
import {
  buildWritingsPager,
  buildCommentPreview,
  buildWritingsCommentsOnlyUrl,
  buildWritingsListUrl
} from '../lib/mypageWritings';
import { AVATAR_IMAGE_RULE, checkImageFile } from '../lib/imageCheck';
import { forgetVerifiedNickname, isVerifiedNickname } from '../lib/nicknameCheck';
import { NICKNAME_MAX } from '../lib/accountRules';

/** '작성한 글 보기'의 게시물·댓글 목록 한 페이지 크기 */
const MY_WRITINGS_PAGE_SIZE = 10;
/** 게시판 관리 목록 한 페이지 크기 */
const BOARDS_ADMIN_PAGE_SIZE = 20;

const mypage = new Hono<AppEnv>();
mypage.use('*', requireLogin);

type CountRow = { count: number };

async function renderProfile(
  c: Context<AppEnv>,
  status: 200 | 400,
  extras: { isSaved?: boolean; profileError?: string | null; isNicknameUnverified?: boolean; formNickname?: string }
) {
  const settings = await getSiteSettings(c.env.DB);
  const shell = await buildMypageShell(c, settings);
  const formNickname = (extras.formNickname ?? '').trim();
  return c.html(
    <MypagePage
      {...shell}
      tab="profile"
      formNickname={formNickname !== '' ? formNickname : shell.profileUser.nickname}
      initialNickname={shell.profileUser.nickname}
      isSaved={Boolean(extras.isSaved)}
      profileError={extras.profileError ?? null}
      isNicknameUnverified={Boolean(extras.isNicknameUnverified)}
    />,
    status
  );
}

mypage.get('/', (c) => renderProfile(c, 200, { isSaved: c.req.query('saved') === '1' }));

mypage.get('/posts', async (c) => {
  const db = c.env.DB;
  const user = c.get('user')!;
  const isAdmin = user.isAdmin;
  const requestedPostPage = parsePageParam(c.req.query('postPage'));
  const requestedCommentPage = parsePageParam(c.req.query('commentPage'));
  const hasPostPageQuery = (c.req.query('postPage') ?? '').trim() !== '';

  // 개수·목록·설정을 한 번에 가져온다 (페이지가 범위를 벗어나면 아래에서 다시 보내고 이 목록은 버린다).
  const [commentCountRes, postCountRes, postListRes, commentListRes, settingRows, settingImageRes] = await db.batch([
    db.prepare('SELECT COUNT(*) AS count FROM comments WHERE user_id = ?').bind(user.id),
    db.prepare('SELECT COUNT(*) AS count FROM posts WHERE author_id = ?').bind(user.id),
    db
      .prepare(
        `SELECT p.id, p.title, p.title_ja, p.created_at, pr.name AS project_name, pr.name_ja AS project_name_ja,
           (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count
         FROM posts p LEFT JOIN projects pr ON p.project_id = pr.id
         WHERE p.author_id = ?
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT ? OFFSET ?`
      )
      .bind(user.id, MY_WRITINGS_PAGE_SIZE, (requestedPostPage - 1) * MY_WRITINGS_PAGE_SIZE),
    db
      .prepare(
        `SELECT c.id, c.content, c.created_at, c.post_id, p.title AS post_title, p.title_ja AS post_title_ja
           FROM comments c JOIN posts p ON p.id = c.post_id
          WHERE c.user_id = ?
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT ? OFFSET ?`
      )
      .bind(user.id, MY_WRITINGS_PAGE_SIZE, (requestedCommentPage - 1) * MY_WRITINGS_PAGE_SIZE),
    ...buildSettingsStatements(db)
  ]);

  const myCommentsTotal = Number((commentCountRes.results[0] as CountRow | undefined)?.count ?? 0);
  const commentPages = countPages(myCommentsTotal, MY_WRITINGS_PAGE_SIZE);
  const commentPage = Math.min(requestedCommentPage, commentPages);
  // 게시물 목록은 관리자만 본다 (일반 회원은 글을 쓸 수 없음).
  const myPostsTotal = isAdmin ? Number((postCountRes.results[0] as CountRow | undefined)?.count ?? 0) : 0;
  const postPages = countPages(myPostsTotal, MY_WRITINGS_PAGE_SIZE);
  const postPage = isAdmin ? Math.min(requestedPostPage, postPages) : 1;

  const canonicalUrl = isAdmin ? buildWritingsListUrl(postPage, commentPage) : buildWritingsCommentsOnlyUrl(commentPage);
  const shouldRedirect = isAdmin
    ? requestedPostPage !== postPage || requestedCommentPage !== commentPage
    : requestedCommentPage !== commentPage || hasPostPageQuery;
  if (shouldRedirect) return c.redirect(canonicalUrl);

  type PostListRow = Omit<MyPostRow, 'created_iso' | 'created_display'> & { created_at: string };
  const myPosts: MyPostRow[] = isAdmin
    ? (postListRes.results as PostListRow[]).map((post) => ({
        ...post,
        comment_count: Number(post.comment_count ?? 0),
        created_iso: toIsoUtc(post.created_at),
        created_display: formatListTime(post.created_at)
      }))
    : [];

  type CommentListRow = { id: number; content: string; created_at: string; post_id: number; post_title: string; post_title_ja: string | null };
  const myComments: MyCommentRow[] = (commentListRes.results as CommentListRow[]).map((comment) => {
    const { previewText, isPreviewTwoLine } = buildCommentPreview(comment.content);
    return {
      id: comment.id,
      post_id: comment.post_id,
      post_title: comment.post_title,
      post_title_ja: comment.post_title_ja,
      preview_text: previewText,
      is_preview_two_line: isPreviewTwoLine,
      created_iso: toIsoUtc(comment.created_at),
      created_display: formatListTime(comment.created_at)
    };
  });

  const settings = parseSettingsResults(settingRows, settingImageRes);
  return c.html(
    <MypagePage
      {...await buildMypageShell(c, settings)}
      tab="posts"
      myPosts={myPosts}
      myPostsTotal={myPostsTotal}
      myPostsPager={isAdmin ? buildWritingsPager(postPage, postPages, (n) => buildWritingsListUrl(n, commentPage)) : []}
      myComments={myComments}
      myCommentsTotal={myCommentsTotal}
      myCommentsPager={buildWritingsPager(commentPage, commentPages, (n) =>
        isAdmin ? buildWritingsListUrl(postPage, n) : buildWritingsCommentsOnlyUrl(n)
      )}
      writingsNext={canonicalUrl}
    />
  );
});

mypage.get('/main-settings', requireAdmin, (c) => renderMainSettings(c, 200, { isSaved: c.req.query('saved') === '1' }));

mypage.get('/boards', requireAdmin, async (c) => {
  const db = c.env.DB;
  const page = parsePageParam(c.req.query('page'));
  const [boardCountRes, listRes, allPostsRes, settingRows, settingImageRes] = await db.batch([
    db.prepare('SELECT COUNT(*) AS count FROM projects'),
    db
      .prepare(
        `SELECT pr.*, (SELECT COUNT(*) FROM posts p WHERE p.project_id = pr.id) AS post_count
           FROM projects pr
          ORDER BY pr.order_num ASC, pr.id ASC
          LIMIT ? OFFSET ?`
      )
      .bind(BOARDS_ADMIN_PAGE_SIZE, (page - 1) * BOARDS_ADMIN_PAGE_SIZE),
    db.prepare('SELECT COUNT(*) AS count FROM posts'),
    ...buildSettingsStatements(db)
  ]);
  const totalPages = countPages(Number((boardCountRes.results[0] as CountRow | undefined)?.count ?? 0), BOARDS_ADMIN_PAGE_SIZE);
  if (page > totalPages) return c.redirect(`/mypage/boards?page=${totalPages}`);

  const isFlagSet = (name: string) => c.req.query(name) === '1';
  const settings = parseSettingsResults(settingRows, settingImageRes);
  return c.html(
    <MypagePage
      {...await buildMypageShell(c, settings)}
      tab="boardsManage"
      boardsList={(listRes.results as BoardRow[]).map((board) => ({ ...board, post_count: Number(board.post_count ?? 0) }))}
      boardsAllPostsCount={Number((allPostsRes.results[0] as CountRow | undefined)?.count ?? 0)}
      page={page}
      totalPages={totalPages}
      paginationItems={buildPaginationItems(page, totalPages)}
      flags={{
        isCreated: isFlagSet('saved'),
        isDeleted: isFlagSet('deleted'),
        isEdited: isFlagSet('editSaved'),
        hasEditError: isFlagSet('editErr')
      }}
    />
  );
});

// 기존 주소 호환: 예전 게시판 관리 주소(/mypage/board)로 들어오면 새 주소로 보낸다.
mypage.get('/board', requireAdmin, (c) => c.redirect('/mypage/boards'));

mypage.post('/profile', async (c) => {
  const db = c.env.DB;
  const user = c.get('user')!;
  if (isFormBodyTooLarge(c, AVATAR_IMAGE_RULE.maxBytes)) {
    return renderProfile(c, 400, { profileError: AVATAR_IMAGE_RULE.tooLargeMessage });
  }
  const body = await readForm(c);
  const rawNickname = readField(body, 'nickname') ?? '';
  const newNickname = rawNickname.trim();
  if (!newNickname || Array.from(newNickname).length > NICKNAME_MAX) {
    return renderProfile(c, 400, { profileError: '닉네임을 1자 이상 20자 이하로 입력해주세요.', formNickname: rawNickname });
  }

  if (newNickname !== user.nickname.trim()) {
    // 「닉네임 중복 확인」을 통과한 값만 적용한다 (확인 결과는 서명 쿠키에 있음).
    if (!(await isVerifiedNickname(c, user.id, newNickname))) {
      return renderProfile(c, 400, { isNicknameUnverified: true, formNickname: newNickname });
    }
    // 중복 확인 뒤 다른 사람이 먼저 가져갔을 수 있어 저장 직전에 한 번 더 본다 (닉네임을 바꿀 때만).
    const taken = await db
      .prepare('SELECT id FROM users WHERE nickname = ? AND id != ?')
      .bind(newNickname, user.id)
      .first<{ id: number }>();
    if (taken) {
      return renderProfile(c, 400, {
        profileError: '이미 사용 중인 닉네임입니다. 다시 중복 확인해주세요.',
        formNickname: newNickname
      });
    }
  }

  const file = readFileField(body, 'avatar');
  if (file) {
    const image = await checkImageFile(file, AVATAR_IMAGE_RULE);
    if ('error' in image) return renderProfile(c, 400, { profileError: image.error, formNickname: newNickname });
    const key = `avatars/${user.id}/${crypto.randomUUID()}`;
    await c.env.MEDIA.put(key, file, { httpMetadata: { contentType: image.mime } });
    // 옛 아바타 키 조회와 저장을 한 번에 보낸다. batch는 순서대로 실행되므로 SELECT는 바꾸기 전 값을 읽는다.
    const [previousRes] = await db.batch([
      db.prepare('SELECT avatar_key FROM users WHERE id = ?').bind(user.id),
      db.prepare('UPDATE users SET nickname = ?, avatar_key = ? WHERE id = ?').bind(newNickname, key, user.id)
    ]);
    const previousKey = (previousRes.results[0] as { avatar_key: string | null } | undefined)?.avatar_key;
    // 옛 아바타 파일 삭제는 응답 뒤에 처리한다.
    if (previousKey) c.executionCtx.waitUntil(c.env.MEDIA.delete(previousKey));
  } else {
    await db.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(newNickname, user.id).run();
  }

  forgetVerifiedNickname(c);
  return c.redirect('/mypage?saved=1');
});

export default mypage;
