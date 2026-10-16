/* PostgreSQL INTEGER/SERIAL 상한. 넘거나 숫자가 아니면 PG가 쿼리 오류(500)를 내므로 미리 거른다. */
const PG_INT_MAX = 2147483647;

/** 경로·폼의 id 값 → 양의 정수, 형식이 아니면 null */
function parseId(v) {
  const s = v == null ? '' : String(v).trim();
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= PG_INT_MAX ? n : null;
}

/** router.param 핸들러: 잘못된 id면 404, 맞으면 req.params 값을 정수로 교체 */
function idParam(notFoundMessage) {
  return function validateIdParam(req, res, next, value, name) {
    const id = parseId(value);
    if (id == null) {
      return res.status(404).render('error', { code: 404, message: notFoundMessage });
    }
    req.params[name] = id;
    next();
  };
}

module.exports = { parseId, idParam, PG_INT_MAX };
