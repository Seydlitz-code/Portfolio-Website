/**
 * 동일 게시글 댓글 목록(parent_id 포함)을 트리(roots[].children…)로 묶습니다.
 */
function buildCommentTree(rows) {
  if (!rows || rows.length === 0) return [];
  const byId = new Map();
  rows.forEach(function (r) {
    const id = Number(r.id);
    const copy = { ...r, id, children: [] };
    byId.set(id, copy);
  });
  const roots = [];
  rows.forEach(function (r) {
    const id = Number(r.id);
    const node = byId.get(id);
    const p = r.parent_id != null && r.parent_id !== '' ? Number(r.parent_id) : null;
    if (p != null && Number.isFinite(p) && byId.has(p)) {
      byId.get(p).children.push(node);
    } else {
      roots.push(node);
    }
  });

  function sortNodes(nodes) {
    nodes.sort(function (a, b) {
      const ta = new Date(a.created_at).getTime();
      const tb = new Date(b.created_at).getTime();
      return ta - tb;
    });
    nodes.forEach(function (n) {
      if (n.children && n.children.length) sortNodes(n.children);
    });
  }
  sortNodes(roots);
  return roots;
}

module.exports = { buildCommentTree };
