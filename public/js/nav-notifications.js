(function () {
  var wrap = document.getElementById('navNotifyWrap');
  if (!wrap) return;

  var btn = document.getElementById('navNotifyBtn');
  var panel = document.getElementById('navNotifyPanel');
  var list = document.getElementById('navNotifyList');
  var emptyEl = document.getElementById('navNotifyEmpty');
  var loadingEl = document.getElementById('navNotifyLoading');
  var readAllBtn = document.getElementById('navNotifyReadAll');
  if (!btn || !panel || !list) return;

  var loadedOnce = false;
  var open = false;

  function setUnreadDot(count) {
    var dot = btn.querySelector('.nav-notify-dot');
    var n = Math.max(0, Number(count) || 0);
    if (n > 0) {
      if (!dot) {
        dot = document.createElement('span');
        dot.className = 'nav-notify-dot';
        dot.setAttribute('aria-label', '안 읽은 알림 ' + n + '건');
        btn.appendChild(dot);
      } else {
        dot.setAttribute('aria-label', '안 읽은 알림 ' + n + '건');
      }
    } else if (dot) {
      dot.remove();
    }
  }

  function setPanelHidden(hide) {
    open = !hide;
    btn.setAttribute('aria-expanded', hide ? 'false' : 'true');
    panel.classList.toggle('is-hidden', hide);
    if (hide) {
      panel.setAttribute('hidden', '');
    } else {
      panel.removeAttribute('hidden');
    }
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s != null ? String(s) : '';
    return d.innerHTML;
  }

  function formatWhen(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    } catch (_) {
      return '';
    }
  }

  function render(items) {
    list.innerHTML = '';
    items.forEach(function (it) {
      var actor = escapeHtml(it.actorNickname || '회원');
      var excerpt = escapeHtml(it.excerpt || '');
      var title = escapeHtml(it.postTitle || '게시물');
      var when = formatWhen(it.createdAt);
      var li = document.createElement('li');
      li.className = 'nav-notify-item';
      li.setAttribute('role', 'listitem');
      if (it.unread) li.classList.add('nav-notify-item--unread');

      var a = document.createElement('a');
      a.href = '/posts/' + Number(it.postId) + '#comments';
      a.className = 'nav-notify-link';
      a.dataset.nid = String(it.id);
      a.dataset.postId = String(it.postId);

      var avSrc = escapeHtml(it.actorAvatar || '');
      var thumbSrc = escapeHtml(it.thumbUrl || '');

      a.innerHTML =
        '<span class="nav-notify-avatar-wrap"><img src="' +
        avSrc +
        '" alt="" class="nav-notify-avatar" width="44" height="44" decoding="async" loading="lazy" ' +
        'onerror="this.onerror=null;this.src=\'/images/default-profile.svg\'"></span>' +
        '<span class="nav-notify-text-wrap">' +
        '<span class="nav-notify-line"><strong>' +
        actor +
        '</strong>님이 댓글을 남겼습니다: 「' +
        excerpt +
        '」</span>' +
        '<span class="nav-notify-meta">' +
        title +
        (when ? ' · ' + escapeHtml(when) : '') +
        '</span></span>' +
        '<span class="nav-notify-thumb-outer">' +
        '<img src="' +
        thumbSrc +
        '" alt="" class="nav-notify-thumb" width="72" height="72" decoding="async" loading="lazy" ' +
        'onerror="this.onerror=null;this.classList.add(\'nav-notify-thumb--fallback\')" /></span>';

      li.appendChild(a);
      list.appendChild(li);
    });
  }

  function showLoading(show) {
    if (loadingEl) loadingEl.classList.toggle('is-hidden', !show);
  }

  function fetchList() {
    showLoading(true);
    if (emptyEl) emptyEl.classList.add('is-hidden');

    fetch('/api/notifications', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    })
      .then(function (res) {
        if (!res.ok) throw new Error('fail');
        return res.json();
      })
      .then(function (data) {
        loadedOnce = true;
        showLoading(false);
        var unread = data.unreadCount != null ? Number(data.unreadCount) : 0;
        setUnreadDot(unread);
        var items = data.items && data.items.length ? data.items : [];
        if (!items.length) {
          render([]);
          if (emptyEl) emptyEl.classList.remove('is-hidden');
        } else {
          if (emptyEl) emptyEl.classList.add('is-hidden');
          render(items);
        }
      })
      .catch(function () {
        loadedOnce = true;
        showLoading(false);
        if (emptyEl) {
          emptyEl.textContent = '알림을 불러오지 못했습니다.';
          emptyEl.classList.remove('is-hidden');
        }
      });
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (open) {
      setPanelHidden(true);
    } else {
      setPanelHidden(false);
      fetchList();
    }
  });

  if (readAllBtn) readAllBtn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    fetch('/api/notifications/read-all', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    })
      .then(function (res) {
        if (!res.ok) throw new Error('fail');
        setUnreadDot(0);
        if (open) fetchList();
      })
      .catch(function () {});
  });

  list.addEventListener('click', function (e) {
    var link = e.target.closest('a.nav-notify-link');
    if (!link) return;
    e.preventDefault();
    var nid = link.dataset.nid;
    var href = link.getAttribute('href') || '';

    fetch('/api/notifications/' + encodeURIComponent(nid) + '/read', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    })
      .finally(function () {
        window.location.href = href;
      });
  });

  document.addEventListener('click', function () {
    if (open) setPanelHidden(true);
  });

  panel.addEventListener('click', function (e) {
    e.stopPropagation();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) setPanelHidden(true);
  });

  /* 최초 HTML에 포함된 카운트는 서버 렌더. 탭 간 동기 없음 — 열 때마다 새로 받음 */
  setPanelHidden(true);
})();
