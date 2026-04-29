const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const { getDb } = require('../config/database');
const { requireLogin, isUserAdmin } = require('../middleware/auth');

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
  const e = { ...(extras || {}) };
  const formNick = e.formNickname != null ? String(e.formNickname).trim() : '';
  delete e.formNickname;

  const db = getDb();
  const row = db.prepare('SELECT id, username, nickname, avatar FROM users WHERE id = ?').get(req.session.user.id);
  if (!row) {
    return null;
  }
  const avatar = row.avatar != null && String(row.avatar).trim() !== '' ? String(row.avatar).trim() : null;
  const displayNickname = formNick !== '' ? formNick : String(row.nickname || '').trim();
  const headerNickname = String(row.nickname || '').trim();

  return {
    activeTab: 'profile',
    headerNickname,
    profileUser: {
      id: row.id,
      nickname: displayNickname,
      username: row.username,
      avatar
    },
    initialNickname: String(row.nickname || '').trim(),
    initialAvatar: avatar,
    mypageAccountActive: true,
    isAdmin: isUserAdmin(req.session.user),
    saved: false,
    profileError: null,
    nicknameDupWarning: false,
    ...e
  };
}

function postsPayload(req, extras) {
  const db = getDb();
  const row = db.prepare('SELECT id, username, nickname, avatar FROM users WHERE id = ?').get(req.session.user.id);
  if (!row) {
    return null;
  }
  const avatar = row.avatar != null && String(row.avatar).trim() !== '' ? String(row.avatar).trim() : null;
  const uid = row.id;
  const headerNickname = String(row.nickname || '').trim();
  const myPosts = db
    .prepare(
      `
    SELECT p.*, pr.name as project_name
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    WHERE p.author_id = ?
    ORDER BY p.created_at DESC
  `
    )
    .all(uid);

  return {
    activeTab: 'posts',
    headerNickname,
    profileUser: {
      id: row.id,
      nickname: row.nickname,
      username: row.username,
      avatar
    },
    initialNickname: String(row.nickname || '').trim(),
    initialAvatar: avatar,
    myPosts,
    mypageAccountActive: true,
    isAdmin: isUserAdmin(req.session.user),
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

router.get('/', requireLogin, (req, res) => {
  const data = profilePayload(req, {
    saved: req.query.saved === '1'
  });
  if (!data) return res.redirect('/auth/logout');
  res.render('mypage-account', data);
});

router.get('/posts', requireLogin, (req, res) => {
  const data = postsPayload(req);
  if (!data) return res.redirect('/auth/logout');
  res.render('mypage-account', data);
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
          return res.status(400).render('mypage-account', data);
        }
        const data = profilePayload(req, {
          profileError: err.message || '이미지 업로드에 실패했습니다.',
          nicknameDupWarning: false,
          formNickname: (req.body && req.body.nickname) || ''
        });
        if (!data) return res.redirect('/auth/logout');
        return res.status(400).render('mypage-account', data);
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
      return res.status(400).render('mypage-account', data);
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
        return res.status(400).render('mypage-account', data);
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
        return res.status(400).render('mypage-account', data);
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
