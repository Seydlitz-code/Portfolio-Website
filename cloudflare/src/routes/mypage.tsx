/** 마이페이지 (기존 routes/mypage.js 이식) */
import { Hono, type Context } from 'hono';
import type { AppEnv } from '../types';
import { MypagePage, type BoardRow, type MyCommentRow, type MyPostRow, type ProfileUser } from '../views/mypage';
import { field, fileField, fileHead, navData, readForm, requireAdmin, requireLogin } from '../lib/http';
import { getSiteSettings, type Settings } from '../lib/siteData';
import { buildPaginationItems, formatListTime, pageParam, toIsoUtc } from '../lib/time';
import {
  buildWritingsPager,
  commentPreviewParts,
  writingsCommentsOnlyUrl,
  writingsListUrl
} from '../lib/mypageWritings';
import { IMAGE_MIMES, verifiedMime } from '../lib/fileSniff';
import { forgetVerifiedNickname, isVerifiedNickname } from '../lib/nicknameCheck';

const MY_WRITINGS_PAGE = 10;
const BOARDS_ADMIN_PAGE_SIZE = 20;
const AVATAR_MAX_BYTES = 3 * 1024 * 1024;

const mypage = new Hono<AppEnv>();
mypage.use('*', requireLogin);

/** 공통 상단·사이드에 쓰는 사용자 정보 */
async function shell(c: Context<AppEnv>, settings: Settings) {
  const user = c.get('user')!;
  const profileUser: ProfileUser = {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    avatar: user.avatarUrl
  };
  return {
    nav: await navData(c, settings, { mypageActive: true }),
    headerNickname: user.nickname,
    profileUser,
    isAdmin: user.isAdmin
  };
}

async function renderProfile(
  c: Context<AppEnv>,
  status: 200 | 400,
  extras: { saved?: boolean; profileError?: string | null; nicknameDupWarning?: boolean; formNickname?: string }
) {
  const settings = await getSiteSettings(c.env.DB);
  const base = await shell(c, settings);
  const formNick = (extras.formNickname ?? '').trim();
  return c.html(
    <MypagePage
      {...base}
      tab="profile"
      formNickname={formNick !== '' ? formNick : base.profileUser.nickname}
      initialNickname={base.profileUser.nickname}
      saved={Boolean(extras.saved)}
      profileError={extras.profileError ?? null}
      nicknameDupWarning={Boolean(extras.nicknameDupWarning)}
    />,
    status
  );
}

/** 메인 페이지 설정 탭 (관리자). /admin/apply 오류 재표시에도 쓴다. */
export async function renderMainSettings(
  c: Context<AppEnv>,
  status: 200 | 400,
  extras: { saved?: boolean; errMessage?: string | null }
) {
  const settings = await getSiteSettings(c.env.DB);
  return c.html(
    <MypagePage
      {...await shell(c, settings)}
      tab="mainSettings"
      settings={settings}
      saved={Boolean(extras.saved)}
      errMessage={extras.errMessage ?? null}
    />,
    status
  );
}

mypage.get('/', (c) => renderProfile(c, 200, { saved: c.req.query('saved') === '1' }));

mypage.get('/posts', async (c) => {
  const db = c.env.DB;
  const user = c.get('user')!;
  const isAdmin = user.isAdmin;
  const reqPostPage = pageParam(c.req.query('postPage'));
  const reqCommentPage = pageParam(c.req.query('commentPage'));
  const hadPostPageQuery = (c.req.query('postPage') ?? '').trim() !== '';

  const myCommentsTotal = Number(
    (await db.prepare('SELECT COUNT(*) AS n FROM comments WHERE user_id = ?').bind(user.id).first<{ n: number }>())?.n ?? 0
  );
  const commentPages = myCommentsTotal === 0 ? 1 : Math.ceil(myCommentsTotal / MY_WRITINGS_PAGE);
  const commentPage = Math.min(reqCommentPage, commentPages);

  let myPosts: MyPostRow[] = [];
  let myPostsTotal = 0;
  let postPage = 1;
  let postPages = 1;
  if (isAdmin) {
    myPostsTotal = Number(
      (await db.prepare('SELECT COUNT(*) AS n FROM posts WHERE author_id = ?').bind(user.id).first<{ n: number }>())?.n ?? 0
    );
    postPages = myPostsTotal === 0 ? 1 : Math.ceil(myPostsTotal / MY_WRITINGS_PAGE);
    postPage = Math.min(reqPostPage, postPages);
    const { results } = await db
      .prepare(
        `SELECT p.id, p.title, p.title_ja, p.created_at, pr.name AS project_name, pr.name_ja AS project_name_ja,
           (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count
         FROM posts p LEFT JOIN projects pr ON p.project_id = pr.id
         WHERE p.author_id = ?
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT ? OFFSET ?`
      )
      .bind(user.id, MY_WRITINGS_PAGE, (postPage - 1) * MY_WRITINGS_PAGE)
      .all<Omit<MyPostRow, 'created_iso' | 'created_display'> & { created_at: string }>();
    myPosts = results.map((p) => ({
      ...p,
      comment_count: Number(p.comment_count ?? 0),
      created_iso: toIsoUtc(p.created_at),
      created_display: formatListTime(p.created_at)
    }));
  }

  const canonical = isAdmin ? writingsListUrl(postPage, commentPage) : writingsCommentsOnlyUrl(commentPage);
  const needsRedirect = isAdmin
    ? reqPostPage !== postPage || reqCommentPage !== commentPage
    : reqCommentPage !== commentPage || hadPostPageQuery;
  if (needsRedirect) return c.redirect(canonical);

  const { results: rawComments } = await db
    .prepare(
      `SELECT c.id, c.content, c.created_at, c.post_id, p.title AS post_title, p.title_ja AS post_title_ja
         FROM comments c JOIN posts p ON p.id = c.post_id
        WHERE c.user_id = ?
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ? OFFSET ?`
    )
    .bind(user.id, MY_WRITINGS_PAGE, (commentPage - 1) * MY_WRITINGS_PAGE)
    .all<{ id: number; content: string; created_at: string; post_id: number; post_title: string; post_title_ja: string | null }>();
  const myComments: MyCommentRow[] = rawComments.map((cm) => {
    const { previewText, previewTwoLine } = commentPreviewParts(cm.content);
    return {
      id: cm.id,
      post_id: cm.post_id,
      post_title: cm.post_title,
      post_title_ja: cm.post_title_ja,
      preview_text: previewText,
      preview_two_line: previewTwoLine,
      created_iso: toIsoUtc(cm.created_at),
      created_display: formatListTime(cm.created_at)
    };
  });

  const settings = await getSiteSettings(db);
  return c.html(
    <MypagePage
      {...await shell(c, settings)}
      tab="posts"
      myPosts={myPosts}
      myPostsTotal={myPostsTotal}
      myPostsPager={isAdmin ? buildWritingsPager(postPage, postPages, (n) => writingsListUrl(n, commentPage)) : []}
      myComments={myComments}
      myCommentsTotal={myCommentsTotal}
      myCommentsPager={buildWritingsPager(commentPage, commentPages, (n) =>
        isAdmin ? writingsListUrl(postPage, n) : writingsCommentsOnlyUrl(n)
      )}
      writingsNext={canonical}
    />
  );
});

mypage.get('/main-settings', requireAdmin, (c) => renderMainSettings(c, 200, { saved: c.req.query('saved') === '1' }));

mypage.get('/boards', requireAdmin, async (c) => {
  const db = c.env.DB;
  const page = pageParam(c.req.query('page'));
  const total = Number((await db.prepare('SELECT COUNT(*) AS n FROM projects').first<{ n: number }>())?.n ?? 0);
  const totalPages = total === 0 ? 1 : Math.ceil(total / BOARDS_ADMIN_PAGE_SIZE);
  if (page > totalPages) return c.redirect(`/mypage/boards?page=${totalPages}`);
  const [list, all] = await db.batch<Record<string, unknown>>([
    db
      .prepare(
        `SELECT pr.*, (SELECT COUNT(*) FROM posts p WHERE p.project_id = pr.id) AS post_count
           FROM projects pr
          ORDER BY pr.order_num ASC, pr.id ASC
          LIMIT ? OFFSET ?`
      )
      .bind(BOARDS_ADMIN_PAGE_SIZE, (page - 1) * BOARDS_ADMIN_PAGE_SIZE),
    db.prepare('SELECT COUNT(*) AS n FROM posts')
  ]);
  const q = (k: string) => c.req.query(k) === '1';
  const settings = await getSiteSettings(db);
  return c.html(
    <MypagePage
      {...await shell(c, settings)}
      tab="boardsManage"
      boardsList={(list.results as BoardRow[]).map((b) => ({ ...b, post_count: Number(b.post_count ?? 0) }))}
      boardsAllPostsCount={Number(all.results[0]?.n ?? 0)}
      page={page}
      totalPages={totalPages}
      paginationItems={buildPaginationItems(page, totalPages)}
      flags={{ saved: q('saved'), deleted: q('deleted'), editSaved: q('editSaved'), editErr: q('editErr') }}
    />
  );
});

mypage.get('/board', requireAdmin, (c) => c.redirect('/mypage/boards'));

mypage.post('/profile', async (c) => {
  const db = c.env.DB;
  const user = c.get('user')!;
  const declared = Number(c.req.header('content-length') || '0');
  if (declared > AVATAR_MAX_BYTES + 1024 * 1024) {
    return renderProfile(c, 400, { profileError: '프로필 이미지는 3MB 이하여야 합니다.' });
  }
  const body = await readForm(c);
  const rawNick = field(body, 'nickname') ?? '';
  const newNick = rawNick.trim();
  if (!newNick || Array.from(newNick).length > 20) {
    return renderProfile(c, 400, { profileError: '닉네임을 1자 이상 20자 이하로 입력해주세요.', formNickname: rawNick });
  }

  const nickChanged = newNick !== user.nickname.trim();
  if (nickChanged) {
    if (!(await isVerifiedNickname(c, user.id, newNick))) {
      return renderProfile(c, 400, { nicknameDupWarning: true, formNickname: newNick });
    }
    const taken = await db.prepare('SELECT id FROM users WHERE nickname = ? AND id != ?').bind(newNick, user.id).first();
    if (taken) {
      return renderProfile(c, 400, {
        profileError: '이미 사용 중인 닉네임입니다. 다시 중복 확인해주세요.',
        formNickname: newNick
      });
    }
  }

  const file = fileField(body, 'avatar');
  if (file) {
    if (file.size > AVATAR_MAX_BYTES) {
      return renderProfile(c, 400, { profileError: '프로필 이미지는 3MB 이하여야 합니다.', formNickname: newNick });
    }
    const mime = verifiedMime(await fileHead(file), IMAGE_MIMES);
    if (!mime) {
      return renderProfile(c, 400, { profileError: '프로필 이미지는 JPG, PNG, GIF, WEBP만 가능합니다.', formNickname: newNick });
    }
    const prev = await db.prepare('SELECT avatar_key FROM users WHERE id = ?').bind(user.id).first<{ avatar_key: string | null }>();
    const key = `avatars/${user.id}/${crypto.randomUUID()}`;
    await c.env.MEDIA.put(key, file, { httpMetadata: { contentType: mime } });
    await db.prepare('UPDATE users SET nickname = ?, avatar_key = ? WHERE id = ?').bind(newNick, key, user.id).run();
    if (prev?.avatar_key) await c.env.MEDIA.delete(prev.avatar_key);
  } else {
    await db.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(newNick, user.id).run();
  }

  forgetVerifiedNickname(c);
  return c.redirect('/mypage?saved=1');
});

export default mypage;
