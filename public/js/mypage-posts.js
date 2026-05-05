/**
 * 마이페이지 — 작성한 글 보기: 게시글·댓글 더보기(10개 단위)
 */
(function () {
  const PAGE = typeof window.__MYPAGE_POSTS_PAGE__ === 'number' ? window.__MYPAGE_POSTS_PAGE__ : 10;

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('ko-KR');
    } catch (e) {
      return '';
    }
  }

  function truncateSnippet(text, max) {
    const s = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (s.length <= max) return s;
    return s.slice(0, max) + '…';
  }

  function buildPostDeleteForm(postId) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/posts/' + postId + '?_method=DELETE';
    form.className = 'mypage-comment-delete-form';
    form.addEventListener('submit', function (ev) {
      if (!window.confirm('정말로 삭제하시겠습니까?')) ev.preventDefault();
    });
    const nextInp = document.createElement('input');
    nextInp.type = 'hidden';
    nextInp.name = 'next';
    nextInp.value = '/mypage/posts';
    const delBtn = document.createElement('button');
    delBtn.type = 'submit';
    delBtn.className = 'mypage-comment-delete-btn';
    delBtn.setAttribute('aria-label', '게시글 삭제');
    delBtn.textContent = '삭제';
    form.appendChild(nextInp);
    form.appendChild(delBtn);
    return form;
  }

  function buildCommentDeleteForm(postId, commentId) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/posts/' + postId + '/comments/' + commentId + '?_method=DELETE';
    form.className = 'mypage-comment-delete-form';
    form.addEventListener('submit', function (ev) {
      if (!window.confirm('정말로 삭제하시겠습니까?')) ev.preventDefault();
    });
    const nextInp = document.createElement('input');
    nextInp.type = 'hidden';
    nextInp.name = 'next';
    nextInp.value = '/mypage/posts';
    const delBtn = document.createElement('button');
    delBtn.type = 'submit';
    delBtn.className = 'mypage-comment-delete-btn';
    delBtn.setAttribute('aria-label', '댓글 삭제');
    delBtn.textContent = '삭제';
    form.appendChild(nextInp);
    form.appendChild(delBtn);
    return form;
  }

  function clearEmptyPlaceholder(ul) {
    if (!ul) return;
    const prev = ul.previousElementSibling;
    if (prev && prev.classList && prev.classList.contains('mypage-writings-empty-plain')) {
      prev.remove();
    }
    const empty = ul.querySelector('.mypage-writings-empty');
    if (empty) empty.remove();
    ul.classList.remove('is-hidden');
  }

  function wirePostsMore() {
    const btn = document.getElementById('myPostsMoreBtn');
    const list = document.getElementById('myPostsList');
    if (!btn || !list) return;

    btn.addEventListener('click', async function () {
      const off = parseInt(btn.getAttribute('data-next-offset'), 10) || PAGE;
      btn.disabled = true;
      try {
        const res = await fetch('/mypage/api/my-posts?offset=' + off + '&limit=' + PAGE, {
          credentials: 'same-origin'
        });
        if (!res.ok) throw new Error('load');
        const data = await res.json();
        clearEmptyPlaceholder(list);
        (data.items || []).forEach(function (post) {
          const li = document.createElement('li');
          li.className = 'mypage-writings-item';
          const a = document.createElement('a');
          a.href = '/posts/' + post.id;
          a.className = 'mypage-writings-item-title';
          a.textContent = post.title || '';
          const time = document.createElement('time');
          time.className = 'mypage-writings-item-meta';
          time.dateTime = post.created_at || '';
          time.textContent = formatDate(post.created_at);
          const foot = document.createElement('div');
          foot.className = 'mypage-writings-post-foot';
          foot.appendChild(time);
          foot.appendChild(buildPostDeleteForm(post.id));
          li.appendChild(a);
          li.appendChild(foot);
          list.appendChild(li);
        });
        btn.setAttribute('data-next-offset', String(off + (data.items || []).length));
        if (!data.hasMore) btn.remove();
      } catch (e) {
        /* 네트워크 오류 등 */
      } finally {
        if (document.body.contains(btn)) btn.disabled = false;
      }
    });
  }

  function wireCommentsMore() {
    const btn = document.getElementById('myCommentsMoreBtn');
    const list = document.getElementById('myCommentsList');
    if (!btn || !list) return;

    btn.addEventListener('click', async function () {
      const off = parseInt(btn.getAttribute('data-next-offset'), 10) || PAGE;
      btn.disabled = true;
      try {
        const res = await fetch('/mypage/api/my-comments?offset=' + off + '&limit=' + PAGE, {
          credentials: 'same-origin'
        });
        if (!res.ok) throw new Error('load');
        const data = await res.json();
        clearEmptyPlaceholder(list);
        (data.items || []).forEach(function (c) {
          const li = document.createElement('li');
          li.className = 'mypage-writings-item mypage-writings-item--comment';
          const wrap = document.createElement('div');
          wrap.className = 'mypage-writings-comment-body';
          const a = document.createElement('a');
          a.href = '/posts/' + c.post_id + '#comments';
          a.className = 'mypage-writings-item-title';
          a.textContent = c.post_title || '';
          const p = document.createElement('p');
          p.className = 'mypage-writings-comment-snippet';
          p.textContent = truncateSnippet(c.content, 140);
          const time = document.createElement('time');
          time.className = 'mypage-writings-item-meta';
          time.dateTime = c.created_at || '';
          time.textContent = formatDate(c.created_at);
          const foot = document.createElement('div');
          foot.className = 'mypage-writings-comment-foot';
          foot.appendChild(time);
          foot.appendChild(buildCommentDeleteForm(c.post_id, c.id));
          wrap.appendChild(a);
          wrap.appendChild(p);
          wrap.appendChild(foot);
          li.appendChild(wrap);
          list.appendChild(li);
        });
        btn.setAttribute('data-next-offset', String(off + (data.items || []).length));
        if (!data.hasMore) btn.remove();
      } catch (e) {
        /* 네트워크 오류 등 */
      } finally {
        if (document.body.contains(btn)) btn.disabled = false;
      }
    });
  }

  wirePostsMore();
  wireCommentsMore();
})();
