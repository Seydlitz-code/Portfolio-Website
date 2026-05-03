/**
 * async Express 핸들러에서 거부된 Promise를 next로 넘김
 */
function asyncRoute(fn) {
  return function asyncRouteWrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncRoute };
