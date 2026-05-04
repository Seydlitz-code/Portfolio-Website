(function () {
  'use strict';

  function extractYoutubeVideoId(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    if (/^[\w-]{11}$/.test(s)) return s;
    try {
      const u = new URL(s.includes('://') ? s : `https://${s}`);
      const host = u.hostname.replace(/^www\./, '');
      if (host === 'youtu.be') {
        const id = u.pathname.replace(/^\//, '').split('/')[0];
        return id && /^[\w-]{11}$/.test(id) ? id : null;
      }
      if (host === 'm.youtube.com' || host.endsWith('youtube.com')) {
        const v = u.searchParams.get('v');
        if (v && /^[\w-]{11}$/.test(v)) return v;
        let m = u.pathname.match(/\/embed\/([\w-]{11})/);
        if (m) return m[1];
        m = u.pathname.match(/\/shorts\/([\w-]{11})/);
        if (m) return m[1];
        m = u.pathname.match(/\/live\/([\w-]{11})/);
        if (m) return m[1];
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  function escAttr(t) {
    return String(t || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/"/g, '&quot;');
  }

  function buildYoutubeEmbedHtml(videoId, originalUrl) {
    const safeId = String(videoId || '').replace(/[^0-9A-Za-z_-]/g, '');
    if (!safeId || safeId.length !== 11) return '';
    const href =
      originalUrl && String(originalUrl).trim()
        ? String(originalUrl).trim()
        : `https://www.youtube.com/watch?v=${safeId}`;
    const hrefEsc = escAttr(href);
    return (
      `<div class="post-embed post-embed--youtube">` +
      `<div class="post-embed-yt-frame">` +
      `<iframe loading="lazy" title="YouTube video" src="https://www.youtube-nocookie.com/embed/${safeId}" ` +
      `allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" ` +
      `allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>` +
      `</div>` +
      `<p class="post-embed-link"><a href="${hrefEsc}" target="_blank" rel="noopener noreferrer">${escAttr(href)}</a></p>` +
      `</div>`
    );
  }

  function insertHtmlAtCaret(editor, html) {
    editor.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      editor.insertAdjacentHTML('beforeend', html);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      editor.insertAdjacentHTML('beforeend', html);
      return;
    }
    range.deleteContents();
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    range.insertNode(tpl.content);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function isMeaningfulHtml(html) {
    const raw = String(html || '');
    if (/<(?:img|video|iframe)\b/i.test(raw)) return true;
    const text = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return text.length > 0;
  }

  function syncEditorToHidden(editor, hidden) {
    hidden.value = editor.innerHTML;
  }

  async function uploadBodyFile(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/posts/body-upload', {
      method: 'POST',
      body: fd,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '업로드에 실패했습니다.');
    if (!data.url) throw new Error('응답이 올바르지 않습니다.');
    return data.url;
  }

  function wrapMediaHtml(url, mime) {
    const m = String(mime || '');
    if (m.startsWith('video/')) {
      return `<p class="post-media-wrap"><video src="${escAttr(url)}" controls playsinline preload="metadata"></video></p>`;
    }
    return `<p class="post-media-wrap"><img src="${escAttr(url)}" alt="" loading="lazy" decoding="async"></p>`;
  }

  async function uploadAndInsert(editor, file) {
    const url = await uploadBodyFile(file);
    const html = wrapMediaHtml(url, file.type);
    insertHtmlAtCaret(editor, html);
  }

  document.addEventListener('DOMContentLoaded', function () {
    const b64El = document.getElementById('post-editor-init-b64');
    const form = document.getElementById('postEditorForm');
    const editor = document.getElementById('postEditorBody');
    const hidden = document.getElementById('postContentHidden');
    const fileImg = document.getElementById('postEditorFileImage');
    const fileVid = document.getElementById('postEditorFileVideo');
    const btnImg = document.getElementById('postEditorBtnImage');
    const btnVid = document.getElementById('postEditorBtnVideo');
    const btnYt = document.getElementById('postEditorBtnYoutube');
    const ytDialog = document.getElementById('postYtDialog');
    const ytInput = document.getElementById('postYtInput');
    const ytApply = document.getElementById('postYtApply');
    const ytCancel = document.getElementById('postYtCancel');

    if (!form || !editor || !hidden) return;

    let init = { html: '', titleKo: '', titleJa: '' };
    try {
      if (b64El && b64El.value) {
        const json = atob(b64El.value);
        init = JSON.parse(json);
      }
    } catch (e) {
      init = { html: '', titleKo: '', titleJa: '' };
    }

    if (init.html) {
      editor.innerHTML = init.html;
    } else {
      editor.innerHTML = '<p><br></p>';
    }

    const titleKoEl = document.getElementById('postTitleKo');
    const titleJaEl = document.getElementById('postTitleJa');
    if (titleKoEl && init.titleKo != null) titleKoEl.value = init.titleKo;
    if (titleJaEl && init.titleJa != null) titleJaEl.value = init.titleJa;

    function applyPlaceholderClass() {
      const t = editor.textContent.replace(/\u00a0/g, ' ').trim();
      const hasMedia = editor.querySelector('img,video,iframe');
      editor.classList.toggle('post-editor-body--empty', t.length === 0 && !hasMedia);
    }
    applyPlaceholderClass();
    editor.addEventListener('input', applyPlaceholderClass);

    btnImg.addEventListener('click', function () {
      fileImg.click();
    });
    btnVid.addEventListener('click', function () {
      fileVid.click();
    });

    fileImg.addEventListener('change', async function () {
      const f = fileImg.files && fileImg.files[0];
      fileImg.value = '';
      if (!f) return;
      try {
        await uploadAndInsert(editor, f);
        applyPlaceholderClass();
      } catch (err) {
        window.alert(err.message || '이미지 업로드 실패');
      }
    });

    fileVid.addEventListener('change', async function () {
      const f = fileVid.files && fileVid.files[0];
      fileVid.value = '';
      if (!f) return;
      try {
        await uploadAndInsert(editor, f);
        applyPlaceholderClass();
      } catch (err) {
        window.alert(err.message || '동영상 업로드 실패');
      }
    });

    btnYt.addEventListener('click', function () {
      ytInput.value = '';
      if (ytDialog.showModal) ytDialog.showModal();
      else ytDialog.setAttribute('open', '');
      setTimeout(function () {
        ytInput.focus();
      }, 50);
    });

    ytCancel.addEventListener('click', function () {
      if (ytDialog.close) ytDialog.close();
      else ytDialog.removeAttribute('open');
    });

    ytApply.addEventListener('click', function () {
      const raw = ytInput.value.trim();
      const id = extractYoutubeVideoId(raw);
      if (!id) {
        window.alert('인식할 수 있는 YouTube 링크가 아닙니다.');
        return;
      }
      const html = buildYoutubeEmbedHtml(id, raw);
      insertHtmlAtCaret(editor, html);
      applyPlaceholderClass();
      if (ytDialog.close) ytDialog.close();
      else ytDialog.removeAttribute('open');
    });

    editor.addEventListener('paste', async function (e) {
      const cd = e.clipboardData;
      if (!cd || !cd.items) return;
      const files = [];
      for (let i = 0; i < cd.items.length; i++) {
        const it = cd.items[i];
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f && (f.type.startsWith('image/') || f.type.startsWith('video/'))) files.push(f);
        }
      }
      if (!files.length) return;
      e.preventDefault();
      for (let j = 0; j < files.length; j++) {
        try {
          await uploadAndInsert(editor, files[j]);
        } catch (err) {
          window.alert(err.message || '붙여넣기 업로드 실패');
        }
      }
      applyPlaceholderClass();
    });

    editor.addEventListener('dragover', function (e) {
      e.preventDefault();
    });
    editor.addEventListener('drop', async function (e) {
      e.preventDefault();
      const dt = e.dataTransfer;
      if (!dt || !dt.files || !dt.files.length) return;
      for (let i = 0; i < dt.files.length; i++) {
        const f = dt.files[i];
        if (!f.type.startsWith('image/') && !f.type.startsWith('video/')) continue;
        try {
          await uploadAndInsert(editor, f);
        } catch (err) {
          window.alert(err.message || '드롭 업로드 실패');
        }
      }
      applyPlaceholderClass();
    });

    form.addEventListener('submit', function (e) {
      syncEditorToHidden(editor, hidden);
      if (!isMeaningfulHtml(hidden.value)) {
        e.preventDefault();
        window.alert('본문을 입력하거나 이미지·동영상·YouTube를 추가해주세요.');
        return;
      }
    });
  });
})();
