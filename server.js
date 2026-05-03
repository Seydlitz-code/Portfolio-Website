const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const path = require('path');
const Database = require('better-sqlite3');
const SqliteSessionStore = require('better-sqlite3-session-store')(session);
const pgSession = require('connect-pg-simple')(session);
const { initializeDatabase, getDataDir, getPool, usePostgres } = require('./config/database');
const db = require('./lib/db');
const { asyncRoute } = require('./lib/asyncRoute');

const authRoutes = require('./routes/auth');
const postsRoutes = require('./routes/posts');
const boardsRoutes = require('./routes/boards');
const adminRoutes = require('./routes/admin');
const mypageRoutes = require('./routes/mypage');
const { isUserAdmin } = require('./middleware/auth');
const { getSiteHomeData } = require('./lib/siteData');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
      const ext = path.extname(filePath);
      if (ext === '.css' || ext === '.js') {
        res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      }
    }
  })
);

function buildSessionMiddleware() {
  if (usePostgres()) {
    const pool = getPool();
    return session({
      store: new pgSession({
        pool,
        tableName: 'portfolio_session',
        createTableIfMissing: true
      }),
      name: 'portfolio.sid',
      secret: process.env.SESSION_SECRET || 'portfolio-secret-lilip-change-in-prod',
      resave: false,
      saveUninitialized: false,
      proxy: true,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7
      }
    });
  }

  const dataDir = getDataDir();
  const sessionDbPath = path.join(dataDir, 'sessions.db');
  const sessionDb = new Database(sessionDbPath);
  sessionDb.pragma('journal_mode = WAL');
  return session({
    store: new SqliteSessionStore({
      client: sessionDb,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 }
    }),
    name: 'portfolio.sid',
    secret: process.env.SESSION_SECRET || 'portfolio-secret-lilip-change-in-prod',
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  });
}

app.use(buildSessionMiddleware());

app.use(
  asyncRoute(async (req, res, next) => {
    const sess = req.session.user;
    if (sess && sess.id != null) {
      try {
        const row = await db.get('SELECT nickname, avatar FROM users WHERE id = ?', [sess.id]);
        if (row) {
          const av =
            row.avatar != null && String(row.avatar).trim() !== ''
              ? String(row.avatar).trim()
              : null;
          res.locals.user = { ...sess, nickname: row.nickname, avatar: av };
        } else {
          res.locals.user = sess;
        }
      } catch (e) {
        res.locals.user = sess;
      }
    } else {
      res.locals.user = null;
    }
    res.locals.isAdmin = isUserAdmin(req.session.user);
    next();
  })
);

app.use('/auth', authRoutes);
app.use('/boards', boardsRoutes);
app.use('/posts', postsRoutes);
app.use('/admin', adminRoutes);
app.use('/mypage', mypageRoutes);

app.get(
  '/',
  asyncRoute(async (req, res) => {
    const home = await getSiteHomeData();
    res.render('index', { ...home });
  })
);

app.use((req, res) => {
  res.status(404).render('error', { code: 404, message: '페이지를 찾을 수 없습니다.' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { code: 500, message: '서버 오류가 발생했습니다.' });
});

async function start() {
  try {
    await initializeDatabase();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`포트폴리오 서버 실행 중: port ${PORT}`);
      console.log(usePostgres() ? '[database] 모드: PostgreSQL' : '[database] 모드: SQLite');
    });
  } catch (e) {
    console.error('[database] 초기화 실패:', e);
    process.exit(1);
  }
}

start();
