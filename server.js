const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const path = require('path');
const SqliteStore = require('connect-sqlite3')(session);
const { initializeDatabase } = require('./db/database');

const authRoutes = require('./routes/auth');
const postsRoutes = require('./routes/posts');
const adminRoutes = require('./routes/admin');
const { isUserAdmin } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Render 등 리버스 프록시 뒤에서 쿠키/HTTPS 감지가 맞게 동작하도록
app.set('trust proxy', 1);

initializeDatabase();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

const dbDir = path.join(__dirname, 'db');
app.use(session({
  store: new SqliteStore({ db: 'sessions.db', dir: dbDir }),
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
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.isAdmin = isUserAdmin(req.session.user);
  next();
});

app.use('/auth', authRoutes);
app.use('/posts', postsRoutes);
app.use('/admin', adminRoutes);

app.get('/', (req, res) => {
  const db = require('./db/database').getDb();

  const settingsRows = db.prepare('SELECT key, value FROM site_settings').all();
  const settings = {};
  settingsRows.forEach(row => { settings[row.key] = row.value; });

  const recentPosts = db.prepare(`
    SELECT p.*, pr.name as project_name
    FROM posts p
    LEFT JOIN projects pr ON p.project_id = pr.id
    ORDER BY p.created_at DESC
    LIMIT 5
  `).all();

  const projects = db.prepare(`
    SELECT * FROM projects ORDER BY order_num ASC, created_at DESC
  `).all();

  const projectsWithPosts = projects.map(project => {
    const posts = db.prepare(`
      SELECT * FROM posts WHERE project_id = ? ORDER BY created_at DESC LIMIT 5
    `).all(project.id);
    return { ...project, posts };
  });

  res.render('index', { settings, recentPosts, projects: projectsWithPosts });
});

app.use((req, res) => {
  res.status(404).render('error', { code: 404, message: '페이지를 찾을 수 없습니다.' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { code: 500, message: '서버 오류가 발생했습니다.' });
});

app.listen(PORT, () => {
  console.log(`포트폴리오 서버 실행 중: http://localhost:${PORT}`);
});
