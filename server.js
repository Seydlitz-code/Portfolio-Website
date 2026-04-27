const express = require('express');
const session = require('express-session');
const methodOverride = require('method-override');
const path = require('path');
const SqliteStore = require('connect-sqlite3')(session);
const { initializeDatabase, getDataDir } = require('./config/database');

const authRoutes = require('./routes/auth');
const postsRoutes = require('./routes/posts');
const adminRoutes = require('./routes/admin');
const { isUserAdmin } = require('./middleware/auth');
const { getSiteHomeData } = require('./lib/siteData');

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

const dataDir = getDataDir();
app.use(session({
  store: new SqliteStore({ db: 'sessions.db', dir: dataDir }),
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
  res.render('index', { ...getSiteHomeData() });
});

app.use((req, res) => {
  res.status(404).render('error', { code: 404, message: '페이지를 찾을 수 없습니다.' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', { code: 500, message: '서버 오류가 발생했습니다.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`포트폴리오 서버 실행 중: port ${PORT}`);
});
