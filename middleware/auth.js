function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/auth/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function isUserAdmin(user) {
  if (!user) return false;
  return Number(user.is_admin) === 1 || user.is_admin === true;
}

function requireAdmin(req, res, next) {
  if (!isUserAdmin(req.session.user)) {
    return res.status(403).render('error', {
      code: 403,
      message: '관리자 권한이 필요합니다.'
    });
  }
  next();
}

module.exports = { requireLogin, requireAdmin, isUserAdmin };
