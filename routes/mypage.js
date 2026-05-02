const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const { getDb } = require('../config/database');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { getAccountShell } = require('../lib/mypageShell');
const { getSiteHomeData, getSiteSettings } = require('../lib/siteData');

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads/avatars');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safe = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) ? ext : '.png';
    cb(null, `user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safe}`);
  }
});

const uploadAvatar = multer({
  storage: avatarStorage,
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('프로필 이미지는 JPG, PNG, GIF, WEBP만 가능합니다.'));
  },
  limits: { fileSize: 3 * 1024 * 1024 }
});

function profilePayload(req, extras) {
  const shell = getAccountShell(req);
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

function postsPayload(req, extras) {
  const shell = getAccountShell(req);
  if (!shell) return null;
  const db = getDb();
  const uid = shell.profileUser.id;

  const myPostsTotal =
    db.prepare('SELECT COUNT(*) as n FROM posts WHERE author_id = ?').get(uid).n || 0;
  const myPosts = db
    .prepare(
      `
    SELECT p.*, pr.name as project_name
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    WHERE p.author_id = ?
    ORDER BY p.created_at DESC
    LIMIT ?
  `
    )
    .all(uid, MY_WRITINGS_PAGE);

  const myCommentsTotal =
    db.prepare('SELECT COUNT(*) as n FROM comments WHERE user_id = ?').get(uid).n || 0;
  const myComments = db
    .prepare(
      `
    SELECT c.id, c.content, c.created_at, c.post_id, p.title as post_title
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    WHERE c.user_id = ?
    ORDER BY c.created_at DESC
    LIMIT ?
  `
    )
    .all(uid, MY_WRITINGS_PAGE);

  return {
    ...shell,
    activeTab: 'posts',
    myPosts,
    myPostsTotal,
    myPostsHasMore: myPostsTotal > MY_WRITINGS_PAGE,
    myComments,
    myCommentsTotal,
    myCommentsHasMore: myCommentsTotal > MY_WRITINGS_PAGE,
    myWritingsPageSize: MY_WRITINGS_PAGE,
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

function accountViewLocals(data) {
  if (!data) return null;
  return {
    ...data,
    settings: data.settings != null ? data.settings : getSiteSettings()
  };
}

router.get('/', requireLogin, (req, res) => {
  const data = profilePayload(req, {
    saved: req.query.saved === '1'
  });
  if (!data) return res.redirect('/auth/logout');
  res.render('mypage-account', accountViewLocals(data));
});

router.get('/posts', requireLogin, (req, res) => {
  const data = postsPayload(req);
  if (!data) return res.redirect('/auth/logout');
  res.render('mypage-account', accountViewLocals(data));
});

router.get('/api/my-posts', requireLogin, (req, res) => {
  const uid = req.session.user.id;
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || MY_WRITINGS_PAGE));
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as n FROM posts WHERE author_id = ?').get(uid).n || 0;
  const items = db
    .prepare(
      `
    SELECT p.*, pr.name as project_name
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    WHERE p.author_id = ?
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `
    )
    .all(uid, limit, offset);
  res.json({
    items,
    total,
    hasMore: offset + items.length < total
  });
});

router.get('/api/my-comments', requireLogin, (req, res) => {
  const uid = req.session.user.id;
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || MY_WRITINGS_PAGE));
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) as n FROM comments WHERE user_id = ?').get(uid).n || 0;
  const items = db
    .prepare(
      `
    SELECT c.id, c.content, c.created_at, c.post_id, p.title as post_title
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    WHERE c.user_id = ?
    ORDER BY c.created_at DESC
    LIMIT ? OFFSET ?
  `
    )
    .all(uid, limit, offset);
  res.json({
    items,
    total,
    hasMore: offset + items.length < total
  });
});

router.get('/main-settings', requireLogin, requireAdmin, (req, res) => {
  const shell = getAccountShell(req);
  if (!shell) return res.redirect('/auth/logout');
  res.render('mypage-account', accountViewLocals({
    ...shell,
    ...getSiteHomeData(),
    activeTab: 'mainSettings',
    saved: req.query.saved === '1',
    errMessage: null
  }));
});

router.get('/board', requireLogin, requireAdmin, (req, res) => {
  const shell = getAccountShell(req);
  if (!shell) return res.redirect('/auth/logout');
  res.render('mypage-account', accountViewLocals({
    ...shell,
    ...getSiteHomeData(),
    activeTab: 'board',
    saved: req.query.saved === '1'
  }));
});

router.post(
  '/profile',
  requireLogin,
  (req, res, next) => {
    uploadAvatar.single('avatar')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          const data = profilePayload(req, {
            profileError: '프로필 이미지는 3MB 이하여야 합니다.',
            nicknameDupWarning: false,
            formNickname: (req.body && req.body.nickname) || ''
          });
          if (!data) return res.redirect('/auth/logout');
          return res.status(400).render('mypage-account', accountViewLocals(data));
        }
        const data = profilePayload(req, {
          profileError: err.message || '이미지 업로드에 실패했습니다.',
          nicknameDupWarning: false,
          formNickname: (req.body && req.body.nickname) || ''
        });
        if (!data) return res.redirect('/auth/logout');
        return res.status(400).render('mypage-account', accountViewLocals(data));
      }
      next();
    });
  },
  (req, res) => {
    const db = getDb();
    const uid = req.session.user.id;
    const row = db.prepare('SELECT id, username, nickname, avatar FROM users WHERE id = ?').get(uid);
    if (!row) {
      if (req.file && req.file.path) try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        /* ignore */
      }
      return res.redirect('/auth/logout');
    }

    const newNick = (req.body.nickname != null ? String(req.body.nickname) : '').trim();
    if (!newNick || newNick.length > 20) {
      if (req.file && req.file.path) try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        /* ignore */
      }
      const data = profilePayload(req, {
        profileError: '닉네임을 1자 이상 20자 이하로 입력해주세요.',
        nicknameDupWarning: false,
        formNickname: (req.body && req.body.nickname) || ''
      });
      return res.status(400).render('mypage-account', accountViewLocals(data));
    }

    const prevNick = String(row.nickname || '').trim();
    const nickChanged = newNick !== prevNick;
    const hadFile = Boolean(req.file);

    if (nickChanged) {
      const verified = req.session.mypageNicknameVerified;
      if (verified !== newNick) {
        if (req.file && req.file.path) try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          /* ignore */
        }
        const data = profilePayload(req, {
          profileError: null,
          nicknameDupWarning: true,
          formNickname: newNick
        });
        return res.status(400).render('mypage-account', accountViewLocals(data));
      }
      const taken = db.prepare('SELECT id FROM users WHERE nickname = ? AND id != ?').get(newNick, uid);
      if (taken) {
        if (req.file && req.file.path) try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          /* ignore */
        }
        const data = profilePayload(req, {
          profileError: '이미 사용 중인 닉네임입니다. 다시 중복 확인해주세요.',
          nicknameDupWarning: false,
          formNickname: newNick
        });
        return res.status(400).render('mypage-account', accountViewLocals(data));
      }
    }

    let nextAvatar = row.avatar != null && String(row.avatar).trim() !== '' ? String(row.avatar).trim() : null;
    if (hadFile) {
      const newPath = `/uploads/avatars/${req.file.filename}`;
      if (nextAvatar && nextAvatar.startsWith('/uploads/avatars/')) {
        tryUnlinkAvatar(nextAvatar);
      }
      nextAvatar = newPath;
    }

    db.prepare('UPDATE users SET nickname = ?, avatar = ? WHERE id = ?').run(newNick, nextAvatar, uid);

    if (req.session) {
      delete req.session.mypageNicknameVerified;
      req.session.user.nickname = newNick;
      req.session.user.avatar = nextAvatar;
    }

    req.session.save((err) => {
      if (err) console.error('Session save error (mypage profile):', err);
      res.redirect('/mypage?saved=1');
    });
  }
);

module.exports = router;
