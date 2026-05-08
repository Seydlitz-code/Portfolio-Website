const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const db = require('../lib/db');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { getAccountShell } = require('../lib/mypageShell');
const { getSiteHomeData, getSiteSettings } = require('../lib/siteData');
const { formatListTime, buildPaginationItems } = require('../lib/listingHelpers');
const { asyncRoute } = require('../lib/asyncRoute');
const { writingsListUrl, writingsCommentsOnlyUrl, commentPreviewParts, buildWritingsPager } = require('../lib/mypageWritings');

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('프로필 이미지는 JPG, PNG, GIF, WEBP만 가능합니다.'));
  },
  limits: { fileSize: 3 * 1024 * 1024 }
});

function runUploadAvatar(req, res) {
  return new Promise((resolve, reject) => {
    uploadAvatar.single('avatar')(req, res, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

async function profilePayload(req, extras) {
  const shell = await getAccountShell(req);
  if (!shell) return null;
  const e = { ...(extras || {}) };
  const formNick = e.formNickname != null ? String(e.formNickname).trim() : '';
  delete e.formNickname;
  const dbNick = shell.initialNickname;
  const displayNickname = formNick !== '' ? formNick : dbNick;
  return {
    ...shell,
    activeTab: 'profile',
    profileUser: {
      ...shell.profileUser,
      nickname: displayNickname
    },
    initialNickname: dbNick,
    initialAvatar: shell.initialAvatar,
    saved: false,
    profileError: null,
    nicknameDupWarning: false,
    ...e
  };
}

const MY_WRITINGS_PAGE = 10;

async function postsPayload(req, extras) {
  const shell = await getAccountShell(req);
  if (!shell) return null;
  const uid = shell.profileUser.id;
  const isAdmin = Boolean(shell.isAdmin);

  const requestedPostPage = Math.max(1, parseInt(req.query.postPage, 10) || 1);
  const requestedCommentPage = Math.max(1, parseInt(req.query.commentPage, 10) || 1);
  const hadPostPageQuery = req.query.postPage != null && String(req.query.postPage).trim() !== '';

  const myCommentsRow = await db.get('SELECT COUNT(*) as n FROM comments WHERE user_id = ?', [uid]);
  const myCommentsTotal = myCommentsRow && myCommentsRow.n != null ? Number(myCommentsRow.n) : 0;
  const myCommentsTotalPages = myCommentsTotal === 0 ? 1 : Math.ceil(myCommentsTotal / MY_WRITINGS_PAGE);
  const myCommentsPage = Math.min(requestedCommentPage, myCommentsTotalPages);

  let myPosts = [];
  let myPostsTotal = 0;
  let myPostsPage = 1;
  let myPostsTotalPages = 1;
  let myPostsPager = [];

  if (isAdmin) {
    const myPostsRow = await db.get('SELECT COUNT(*) as n FROM posts WHERE author_id = ?', [uid]);
    myPostsTotal = myPostsRow && myPostsRow.n != null ? Number(myPostsRow.n) : 0;
    myPostsTotalPages = myPostsTotal === 0 ? 1 : Math.ceil(myPostsTotal / MY_WRITINGS_PAGE);
    myPostsPage = Math.min(requestedPostPage, myPostsTotalPages);

    const postsOffset = (myPostsPage - 1) * MY_WRITINGS_PAGE;
    myPosts = await db.all(
      `
    SELECT p.*, pr.name AS project_name, pr.name_ja AS project_name_ja,
      (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comment_count
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    WHERE p.author_id = ?
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `,
      [uid, MY_WRITINGS_PAGE, postsOffset]
    );

    myPostsPager = buildWritingsPager(myPostsPage, myPostsTotalPages, (pn) =>
      writingsListUrl(pn, myCommentsPage)
    );
  }

  const canonicalUrl = isAdmin
    ? writingsListUrl(myPostsPage, myCommentsPage)
    : writingsCommentsOnlyUrl(myCommentsPage);
  const writingsNeedsRedirect = isAdmin
    ? requestedPostPage !== myPostsPage || requestedCommentPage !== myCommentsPage
    : requestedCommentPage !== myCommentsPage || hadPostPageQuery;

  const commentsOffset = (myCommentsPage - 1) * MY_WRITINGS_PAGE;

  const myCommentsRaw = await db.all(
    `
    SELECT c.id, c.content, c.created_at, c.post_id, p.title AS post_title, p.title_ja AS post_title_ja
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    WHERE c.user_id = ?
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `,
    [uid, MY_WRITINGS_PAGE, commentsOffset]
  );

  const hrefForCommentPage = isAdmin
    ? (cn) => writingsListUrl(myPostsPage, cn)
    : (cn) => writingsCommentsOnlyUrl(cn);

  const myCommentsPager = buildWritingsPager(myCommentsPage, myCommentsTotalPages, hrefForCommentPage);

  const myComments = myCommentsRaw.map((c) => {
    const { previewText, previewTwoLine } = commentPreviewParts(c.content);
    return { ...c, preview_text: previewText, preview_two_line: previewTwoLine };
  });

  const mypageWritingsNext = canonicalUrl;

  return {
    ...shell,
    activeTab: 'posts',
    myPosts,
    myPostsTotal,
    myPostsPage,
    myPostsTotalPages,
    myPostsPager,
    myComments,
    myCommentsTotal,
    myCommentsPage,
    myCommentsTotalPages,
    myCommentsPager,
    myWritingsPageSize: MY_WRITINGS_PAGE,
    formatListTime,
    writingsNeedsRedirect,
    writingsCanonicalUrl: canonicalUrl,
    mypageWritingsNext,
    ...(extras || {})
  };
}

function tryUnlinkAvatar(publicPath) {
  if (!publicPath || typeof publicPath !== 'string') return;
  const p = publicPath.trim();
  if (!p.startsWith('/uploads/avatars/')) return;
  const abs = path.join(__dirname, '../public', p.replace(/^\//, ''));
  if (abs.includes('..')) return;
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (e) {
    /* ignore */
  }
}

async function accountViewLocals(data) {
  if (!data) return null;
  return {
    ...data,
    settings: data.settings != null ? data.settings : await getSiteSettings()
  };
}

router.get(
  '/',
  requireLogin,
  asyncRoute(async (req, res) => {
    const data = await profilePayload(req, {
      saved: req.query.saved === '1'
    });
    if (!data) return res.redirect('/auth/logout');
    res.render('mypage-account', await accountViewLocals(data));
  })
);

router.get(
  '/posts',
  requireLogin,
  asyncRoute(async (req, res) => {
    const data = await postsPayload(req);
    if (!data) return res.redirect('/auth/logout');
    if (data.writingsNeedsRedirect) {
      return res.redirect(302, data.writingsCanonicalUrl);
    }
    delete data.writingsNeedsRedirect;
    delete data.writingsCanonicalUrl;
    res.render('mypage-account', await accountViewLocals(data));
  })
);

router.get(
  '/main-settings',
  requireLogin,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const shell = await getAccountShell(req);
    if (!shell) return res.redirect('/auth/logout');
    const home = await getSiteHomeData();
    res.render(
      'mypage-account',
      await accountViewLocals({
        ...shell,
        ...home,
        activeTab: 'mainSettings',
        saved: req.query.saved === '1',
        errMessage: null
      })
    );
  })
);

const BOARDS_ADMIN_PAGE_SIZE = 20;

router.get(
  '/boards',
  requireLogin,
  requireAdmin,
  asyncRoute(async (req, res) => {
    const shell = await getAccountShell(req);
    if (!shell) return res.redirect('/auth/logout');
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const totalRow = await db.get('SELECT COUNT(*) as c FROM projects');
    const total = totalRow && totalRow.c != null ? Number(totalRow.c) : 0;
    const totalPages = total === 0 ? 1 : Math.ceil(total / BOARDS_ADMIN_PAGE_SIZE);
    if (page > totalPages) {
      return res.redirect('/mypage/boards?page=' + totalPages);
    }
    const offset = (page - 1) * BOARDS_ADMIN_PAGE_SIZE;
    const boardsList = await db.all(
      `
    SELECT pr.*,
      (SELECT COUNT(*) FROM posts p WHERE p.project_id = pr.id) AS post_count
    FROM projects pr
    ORDER BY pr.order_num ASC, pr.id ASC
    LIMIT ? OFFSET ?
  `,
      [BOARDS_ADMIN_PAGE_SIZE, offset]
    );
    const allPostsCountRow = await db.get('SELECT COUNT(*) AS c FROM posts');
    const boardsAllPostsCount =
      allPostsCountRow && allPostsCountRow.c != null ? Number(allPostsCountRow.c) : 0;
    const boardsPaginationItems = buildPaginationItems(page, totalPages);
    const home = await getSiteHomeData();
    res.render(
      'mypage-account',
      await accountViewLocals({
        ...shell,
        ...home,
        activeTab: 'boardsManage',
        boardsList,
        boardsAllPostsCount,
        boardsPage: page,
        boardsTotalPages: totalPages,
        boardsTotal: total,
        boardsPageSize: BOARDS_ADMIN_PAGE_SIZE,
        boardsPaginationItems,
        boardsSaved: req.query.saved === '1',
        boardsDeleted: req.query.deleted === '1',
        boardsDeleteBlocked: req.query.deleteBlocked === '1',
        boardsCreateErr: req.query.createErr === '1',
        boardsEditSaved: req.query.editSaved === '1',
        boardsEditErr: req.query.editErr === '1'
      })
    );
  })
);

router.get('/board', requireLogin, requireAdmin, (req, res) => {
  res.redirect(302, '/mypage/boards');
});

router.post(
  '/profile',
  requireLogin,
  asyncRoute(async (req, res) => {
    try {
      await runUploadAvatar(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        const data = await profilePayload(req, {
          profileError: '프로필 이미지는 3MB 이하여야 합니다.',
          nicknameDupWarning: false,
          formNickname: (req.body && req.body.nickname) || ''
        });
        if (!data) return res.redirect('/auth/logout');
        return res.status(400).render('mypage-account', await accountViewLocals(data));
      }
      const data = await profilePayload(req, {
        profileError: err.message || '이미지 업로드에 실패했습니다.',
        nicknameDupWarning: false,
        formNickname: (req.body && req.body.nickname) || ''
      });
      if (!data) return res.redirect('/auth/logout');
      return res.status(400).render('mypage-account', await accountViewLocals(data));
    }

    const uid = req.session.user.id;
    const row = await db.get('SELECT id, username, nickname, avatar FROM users WHERE id = ?', [uid]);
    if (!row) {
      return res.redirect('/auth/logout');
    }

    const newNick = (req.body.nickname != null ? String(req.body.nickname) : '').trim();
    if (!newNick || newNick.length > 20) {
      const data = await profilePayload(req, {
        profileError: '닉네임을 1자 이상 20자 이하로 입력해주세요.',
        nicknameDupWarning: false,
        formNickname: (req.body && req.body.nickname) || ''
      });
      return res.status(400).render('mypage-account', await accountViewLocals(data));
    }

    const prevNick = String(row.nickname || '').trim();
    const nickChanged = newNick !== prevNick;
    const hadFile = Boolean(req.file && req.file.buffer && req.file.buffer.length);

    if (nickChanged) {
      const verified = req.session.mypageNicknameVerified;
      if (verified !== newNick) {
        const data = await profilePayload(req, {
          profileError: null,
          nicknameDupWarning: true,
          formNickname: newNick
        });
        return res.status(400).render('mypage-account', await accountViewLocals(data));
      }
      const taken = await db.get('SELECT id FROM users WHERE nickname = ? AND id != ?', [newNick, uid]);
      if (taken) {
        const data = await profilePayload(req, {
          profileError: '이미 사용 중인 닉네임입니다. 다시 중복 확인해주세요.',
          nicknameDupWarning: false,
          formNickname: newNick
        });
        return res.status(400).render('mypage-account', await accountViewLocals(data));
      }
    }

    let nextAvatar = row.avatar != null && String(row.avatar).trim() !== '' ? String(row.avatar).trim() : null;
    if (hadFile) {
      const buf = req.file.buffer;
      const mime = req.file.mimetype;
      if (nextAvatar && nextAvatar.startsWith('/uploads/avatars/')) {
        tryUnlinkAvatar(nextAvatar);
      }
      nextAvatar = `/media/user/${uid}/avatar`;
      await db.run(
        'UPDATE users SET nickname = ?, avatar = ?, avatar_mime = ?, avatar_blob = ? WHERE id = ?',
        [newNick, nextAvatar, mime, buf, uid]
      );
    } else {
      await db.run('UPDATE users SET nickname = ?, avatar = ? WHERE id = ?', [newNick, nextAvatar, uid]);
    }

    if (req.session) {
      delete req.session.mypageNicknameVerified;
      req.session.user.nickname = newNick;
      req.session.user.avatar = nextAvatar;
    }

    req.session.save((err) => {
      if (err) console.error('Session save error (mypage profile):', err);
      res.redirect('/mypage?saved=1');
    });
  })
);

module.exports = router;
