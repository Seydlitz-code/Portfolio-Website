/**
 * pg Row 등 드라이버 전용 속성 없이 템플릿·정렬용 일반 객체로 만듭니다.
 */
function plainCommentNode(r) {
  const pid =
    r.parent_id != null && r.parent_id !== '' ? Number(r.parent_id) : null;
  return {
    id: Number(r.id),
    post_id: r.post_id != null ? Number(r.post_id) : null,
    user_id: r.user_id != null ? Number(r.user_id) : null,
    parent_id: Number.isFinite(pid) ? pid : null,
    content: r.content != null ? String(r.content) : '',
    created_at: r.created_at,
    updated_at: r.updated_at,
    nickname: r.nickname != null ? String(r.nickname) : '',
    user_avatar: r.user_avatar != null ? r.user_avatar : null,
    comment_edited: Boolean(r.comment_edited),
    display_time_line: r.display_time_line != null ? String(r.display_time_line) : '',
    children: []
  };
}

function createdAtMs(node) {
  const t = new Date(node.created_at).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * id를 parent_id 삼아 올라가며 targetId 또는 이미 방문한 id를 만나면 true.
 * 깨진 parent_id 순환 때문에 부분 템플릿이 무한 재귀하지 않도록 합니다.
 */
function ancestorIncludesTarget(byId, startParentId, targetId) {
  const seen = new Set();
  let cur =
    startParentId != null && startParentId !== '' ? Number(startParentId) : null;
  while (cur != null && Number.isFinite(cur)) {
    if (cur === targetId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    const nextNode = byId.get(cur);
    if (!nextNode) break;
    const raw = nextNode.parent_id;
    cur = raw != null && raw !== '' ? Number(raw) : null;
  }
  return false;
}

/**
 * 동일 게시글 댓글 목록(parent_id 포함)을 트리(roots[].children…)로 묶습니다.
 * parent_id 순환 등 잘못된 데이터에서는 스택 깊이 무한증가를 피하기 위해 근접 루트로 둡니다.
 */
function buildCommentTree(rows) {
  if (!rows || rows.length === 0) return [];
  const byId = new Map();
  rows.forEach(function (r) {
    const id = Number(r.id);
    if (!Number.isFinite(id)) return;
    byId.set(id, plainCommentNode(r));
  });
  const roots = [];
  rows.forEach(function (r) {
    const id = Number(r.id);
    if (!Number.isFinite(id)) return;
    const node = byId.get(id);
    if (!node) return;
    const p = r.parent_id != null && r.parent_id !== '' ? Number(r.parent_id) : null;
    /* 자기·순환·부모 누락 시 최상위. 부모는 DB 컬럼 parent_id 따라 상향 탐색해 순환만 검출 */
    if (
      p != null &&
      p !== id &&
      Number.isFinite(p) &&
      byId.has(p) &&
      !ancestorIncludesTarget(byId, p, id)
    ) {
      byId.get(p).children.push(node);
    } else {
      roots.push(node);
    }
  });

  function sortNodes(nodes) {
    nodes.sort(function (a, b) {
      const d = createdAtMs(a) - createdAtMs(b);
      return d !== 0 ? d : a.id - b.id;
    });
    nodes.forEach(function (n) {
      if (n.children && n.children.length) sortNodes(n.children);
    });
  }
  sortNodes(roots);
  return roots;
}

module.exports = { buildCommentTree };
