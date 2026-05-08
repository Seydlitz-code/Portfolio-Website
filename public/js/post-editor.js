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

  function escapeHtmlText(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/'/g, '&#39;')
      .replace(/"/g, '&quot;');
  }

  /** Base64(UTF-8 바이트) → UTF-8 문자열 */
  function base64ToUtf8(b64) {
    const bin = atob(String(b64 || '').trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i) & 0xff;
    }
    return new TextDecoder('utf-8').decode(bytes);
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
    const clone = document.createElement('div');
    clone.innerHTML = raw;
    clone.querySelectorAll('.post-editor-guide-inline').forEach(function (n) {
      n.remove();
    });
    const text = clone.textContent.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
    return text.length > 0;
  }

  function syncEditorToHidden(editor, hidden) {
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('.post-editor-guide-inline').forEach(function (n) {
      n.remove();
    });
    hidden.value = clone.innerHTML;
  }

  let savedEditorRange = null;

  /** 툴바 클릭 시 contenteditable 선택이 유지되지 않아 복원용으로 스냅샷 저장 */
  function saveEditorSelection(editor) {
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      savedEditorRange = null;
      return;
    }
    const r = sel.getRangeAt(0);
    if (!editor.contains(r.commonAncestorContainer)) {
      savedEditorRange = null;
      return;
    }
    savedEditorRange = r.cloneRange();
  }

  function restoreEditorSelection(editor) {
    if (!editor || !savedEditorRange) return false;
    try {
      if (!editor.contains(savedEditorRange.commonAncestorContainer)) return false;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedEditorRange);
      editor.focus();
      return true;
    } catch (err) {
      savedEditorRange = null;
      return false;
    }
  }

  function clearStoredSelection() {
    savedEditorRange = null;
  }

  function applyInlineStyle(editor, prop, value) {
    restoreEditorSelection(editor);
    clearStoredSelection();
    editor.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    if (range.collapsed) {
      const span = document.createElement('span');
      span.style[prop] = value;
      span.appendChild(document.createTextNode('\u200b'));
      range.insertNode(span);
      range.setStart(span.firstChild, 1);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }

    try {
      const span = document.createElement('span');
      span.style[prop] = value;
      range.surroundContents(span);
      range.selectNodeContents(span);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err) {
      const contents = range.extractContents();
      const span = document.createElement('span');
      span.style[prop] = value;
      span.appendChild(contents);
      range.insertNode(span);
      range.selectNodeContents(span);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function execRtf(editor, cmd, val) {
    restoreEditorSelection(editor);
    clearStoredSelection();
    editor.focus();
    try {
      document.execCommand('styleWithCSS', false, true);
    } catch (e1) {
      /* ignore */
    }
    try {
      if (val === undefined) document.execCommand(cmd, false);
      else document.execCommand(cmd, false, val);
    } catch (e2) {
      /* ignore */
    }
  }

  function refreshFmtButtonStates(fmtBar, editor) {
    if (!fmtBar) return;
    const cmds = ['bold', 'italic', 'underline', 'strikeThrough'];
    cmds.forEach(function (cmd) {
      const btn = fmtBar.querySelector('[data-cmd="' + cmd + '"]');
      if (!btn) return;
      try {
        if (document.activeElement !== editor && !editor.contains(window.getSelection().anchorNode)) {
          btn.classList.remove('is-active');
          return;
        }
        btn.classList.toggle('is-active', document.queryCommandState(cmd));
      } catch (e) {
        btn.classList.remove('is-active');
      }
    });
  }

  /** 색 격자 (8열 × 7행) */
  function colorSwatchList() {
    const rows = [
      ['#000000', '#434343', '#666666', '#888888', '#aaaaaa', '#cccccc', '#e8e8e8', '#ffffff'],
      ['#ee4339', '#ff6b35', '#f8941d', '#ffcb00', '#ffd966', '#69b34c', '#2ecc71', '#1abc9c'],
      ['#16a085', '#3498db', '#2874a6', '#8e44ad', '#9b59b6', '#e91e8c', '#ff69b4', '#fce4ec'],
      ['#5d4037', '#795548', '#a1887f', '#bcaaa4', '#efebe9', '#424242', '#757575', '#bdbdbd'],
      ['#c62828', '#d84315', '#ef6c00', '#f9a825', '#fbc02d', '#558b2f', '#00796b', '#00695c'],
      ['#0277bd', '#283593', '#5e35b1', '#6a1b9a', '#ad1457', '#c2185b', '#4e342e', '#3e2723'],
      ['#212121', '#37474f', '#455a64', '#546e7a', '#78909c', '#90a4ae', '#b0bec5', '#cfd8dc']
    ];
    return rows.flat();
  }

  function buildSwatchGrid(container, kind) {
    if (!container) return;
    container.textContent = '';
    const frag = document.createDocumentFragment();
    colorSwatchList().forEach(function (hex) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'post-editor-swatch' + (kind === 'fg' ? ' post-editor-swatch--fg' : ' post-editor-swatch--bg');
      b.setAttribute('data-hex', hex);
      b.setAttribute('data-kind', kind);
      b.title = hex;
      b.style.background = hex;
      if (hex.toLowerCase() === '#ffffff' || hex.toLowerCase() === '#e8e8e8') {
        b.style.border = '1px solid #bbb';
      }
      frag.appendChild(b);
    });
    container.appendChild(frag);
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

  function removeGuideSpan(editor) {
    editor.querySelectorAll('.post-editor-guide-inline').forEach(function (n) {
      n.remove();
    });
  }

  function getPlainTextSansGuide(editor) {
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('.post-editor-guide-inline').forEach(function (n) {
      n.remove();
    });
    return clone.textContent.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
  }

  function clampFontSizePx(v) {
    const n = parseInt(v, 10);
    if (Number.isNaN(n)) return 10;
    return Math.min(72, Math.max(6, n));
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
    const fmtBar = document.querySelector('.post-editor-toolbar--format');
    const selFont = document.getElementById('postEditorFontFamily');
    const selSizePreset = document.getElementById('postEditorFontSizePreset');
    const inpSize = document.getElementById('postEditorFontSize');
    const colorBtn = document.getElementById('postEditorColorBtn');
    const colorPanel = document.getElementById('postEditorColorPanel');
    const fgGrid = document.getElementById('postEditorFgGrid');
    const bgGrid = document.getElementById('postEditorBgGrid');
    const fgPicker = document.getElementById('postEditorFgColorHidden');
    const bgPicker = document.getElementById('postEditorBgColorHidden');

    if (!form || !editor || !hidden) return;

    const placeholderText = (editor.getAttribute('data-placeholder') || '').trim() ||
      '게시물 본문을 입력하세요. 이미지·동영상은 버튼으로 추가하거나 붙여넣기·드래그 앤 드롭할 수 있습니다.';

    let init = { html: '', titleKo: '', titleJa: '' };
    try {
      if (b64El && b64El.value) {
        const json = base64ToUtf8(b64El.value);
        init = JSON.parse(json);
      }
    } catch (e) {
      init = { html: '', titleKo: '', titleJa: '' };
    }

    if (init.html && isMeaningfulHtml(init.html)) {
      editor.innerHTML = init.html;
    } else {
      editor.innerHTML =
        '<p class="post-editor-first-line">' +
        '<span class="post-editor-guide-inline" contenteditable="false">' +
        escapeHtmlText(placeholderText) +
        '</span><br></p>';
    }

    const titleKoEl = document.getElementById('postTitleKo');
    const titleJaEl = document.getElementById('postTitleJa');
    if (titleKoEl && init.titleKo != null) titleKoEl.value = init.titleKo;
    if (titleJaEl && init.titleJa != null) titleJaEl.value = init.titleJa;

    function applyPlaceholderClass() {
      const hasGuide = !!editor.querySelector('.post-editor-guide-inline');
      const t = getPlainTextSansGuide(editor);
      const hasMedia = editor.querySelector('img,video,iframe');
      editor.classList.toggle('post-editor-body--empty', t.length === 0 && !hasMedia && !hasGuide);
      editor.classList.toggle('post-editor-body--has-guide', hasGuide);
    }
    applyPlaceholderClass();

    function moveCaretAfterGuide() {
      const g = editor.querySelector('.post-editor-guide-inline');
      if (!g || !editor.contains(g)) return;
      const sel = window.getSelection();
      if (!sel) return;
      try {
        const r = document.createRange();
        r.setStartAfter(g);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (e2) {
        /* noop */
      }
    }

    editor.addEventListener('click', function () {
      setTimeout(moveCaretAfterGuide, 0);
    });
    editor.addEventListener('focusin', function () {
      moveCaretAfterGuide();
    });

    editor.addEventListener('beforeinput', function (e) {
      const g = editor.querySelector('.post-editor-guide-inline');
      if (!g) return;
      if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward') return;
      removeGuideSpan(editor);
      applyPlaceholderClass();
    });

    editor.addEventListener('input', function () {
      const g = editor.querySelector('.post-editor-guide-inline');
      if (g && getPlainTextSansGuide(editor).length > 0) removeGuideSpan(editor);
      applyPlaceholderClass();
      refreshFmtButtonStates(fmtBar, editor);
    });

    let selTimer;
    document.addEventListener('selectionchange', function () {
      clearTimeout(selTimer);
      selTimer = setTimeout(function () {
        refreshFmtButtonStates(fmtBar, editor);
      }, 80);
    });

    if (fmtBar) {
      fmtBar.addEventListener(
        'mousedown',
        function () {
          saveEditorSelection(editor);
        },
        true
      );

      fmtBar.addEventListener('mousedown', function (e) {
        if (
          e.target.closest &&
          (e.target.closest('button.post-editor-fmt-btn') ||
            e.target.closest('#postEditorColorBtn'))
        ) {
          e.preventDefault();
        }
      });

      fmtBar.addEventListener('click', function (e) {
        const cmdBtn = e.target.closest('[data-cmd]');
        if (cmdBtn) {
          const cmd = cmdBtn.getAttribute('data-cmd');
          execRtf(editor, cmd);
          applyPlaceholderClass();
          refreshFmtButtonStates(fmtBar, editor);
          return;
        }
        const jBtn = e.target.closest('[data-justify]');
        if (jBtn) {
          const j = jBtn.getAttribute('data-justify');
          const map = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight' };
          if (map[j]) execRtf(editor, map[j]);
          applyPlaceholderClass();
        }
      });
    }

    if (selFont) {
      selFont.addEventListener('change', function () {
        const v = this.value;
        if (!v) return;
        applyInlineStyle(editor, 'fontFamily', v);
        this.selectedIndex = 0;
        applyPlaceholderClass();
      });
    }

    function applyFontSizeFromInput() {
      if (!inpSize) return;
      const px = clampFontSizePx(inpSize.value);
      inpSize.value = String(px);
      applyInlineStyle(editor, 'fontSize', px + 'px');
      applyPlaceholderClass();
    }

    if (selSizePreset) {
      selSizePreset.addEventListener('change', function () {
        const raw = String(this.value || '').trim();
        if (!raw) return;
        const px = clampFontSizePx(raw);
        if (inpSize) inpSize.value = String(px);
        applyInlineStyle(editor, 'fontSize', px + 'px');
        this.selectedIndex = 0;
        applyPlaceholderClass();
      });
    }

    if (inpSize) {
      inpSize.addEventListener('change', applyFontSizeFromInput);
      inpSize.addEventListener('blur', function () {
        const px = clampFontSizePx(inpSize.value);
        inpSize.value = String(px);
      });
      inpSize.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyFontSizeFromInput();
          inpSize.blur();
        }
      });
    }

    function applyColor(kind, hex) {
      if (kind === 'fg') {
        execRtf(editor, 'foreColor', hex);
      } else {
        try {
          document.execCommand('styleWithCSS', false, true);
        } catch (e1) {
          /* */
        }
        if (String(hex).toLowerCase() === 'transparent') {
          try {
            document.execCommand('hiliteColor', false, 'transparent');
          } catch (e2) {
            applyInlineStyle(editor, 'backgroundColor', 'transparent');
          }
        } else {
          execRtf(editor, 'hiliteColor', hex);
        }
      }
      applyPlaceholderClass();
      closeColorPanel();
    }

    function closeColorPanel() {
      if (!colorPanel) return;
      colorPanel.classList.add('is-hidden');
      if (colorBtn) colorBtn.setAttribute('aria-expanded', 'false');
    }

    function openColorPanel() {
      if (!colorPanel) return;
      colorPanel.classList.remove('is-hidden');
      if (colorBtn) colorBtn.setAttribute('aria-expanded', 'true');
    }

    function toggleColorPanel() {
      if (!colorPanel) return;
      if (colorPanel.classList.contains('is-hidden')) openColorPanel();
      else closeColorPanel();
    }

    if (fgGrid && bgGrid) {
      buildSwatchGrid(fgGrid, 'fg');
      buildSwatchGrid(bgGrid, 'bg');
    }

    if (colorBtn && colorPanel) {
      colorBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleColorPanel();
      });
    }

    colorPanel &&
      colorPanel.addEventListener('click', function (e) {
        const sw = e.target.closest('.post-editor-swatch');
        if (sw) {
          e.preventDefault();
          applyColor(sw.getAttribute('data-kind'), sw.getAttribute('data-hex'));
          return;
        }
        const preset = e.target.closest('[data-color-action]');
        if (preset) {
          e.preventDefault();
          const act = preset.getAttribute('data-color-action');
          if (act === 'fg-black') applyColor('fg', '#000000');
          else if (act === 'bg-transparent') applyColor('bg', 'transparent');
          return;
        }
        const more = e.target.closest('[data-color-more]');
        if (!more) return;
        e.preventDefault();
        const k = more.getAttribute('data-color-more');
        if (k === 'fg') {
          if (fgPicker) fgPicker.click();
        } else if (k === 'bg') {
          if (bgPicker) bgPicker.click();
        }
      });

    if (fgPicker) {
      fgPicker.addEventListener('input', function () {
        editor.focus();
        execRtf(editor, 'foreColor', fgPicker.value);
        applyPlaceholderClass();
        closeColorPanel();
      });
    }
    if (bgPicker) {
      bgPicker.addEventListener('input', function () {
        editor.focus();
        try {
          document.execCommand('styleWithCSS', false, true);
        } catch (e1) {
          /* */
        }
        execRtf(editor, 'hiliteColor', bgPicker.value);
        applyPlaceholderClass();
        closeColorPanel();
      });
    }

    document.addEventListener('mousedown', function (e) {
      if (!colorPanel || colorPanel.classList.contains('is-hidden')) return;
      if (colorPanel.contains(e.target)) return;
      if (colorBtn && colorBtn.contains(e.target)) return;
      closeColorPanel();
    });

    editor.addEventListener('keydown', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      const k = String(e.key || '').toLowerCase();
      if (k === 'b') {
        e.preventDefault();
        execRtf(editor, 'bold');
        refreshFmtButtonStates(fmtBar, editor);
      } else if (k === 'i') {
        e.preventDefault();
        execRtf(editor, 'italic');
        refreshFmtButtonStates(fmtBar, editor);
      } else if (k === 'u') {
        e.preventDefault();
        execRtf(editor, 'underline');
        refreshFmtButtonStates(fmtBar, editor);
      }
    });

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
        removeGuideSpan(editor);
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
        removeGuideSpan(editor);
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
      removeGuideSpan(editor);
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
      removeGuideSpan(editor);
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
      removeGuideSpan(editor);
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
      const projectSel = document.getElementById('postProjectId');
      if (projectSel && (!projectSel.value || String(projectSel.value).trim() === '')) {
        e.preventDefault();
        window.alert('게시판을 선택해주세요. 등록하려면 분류가 있는 게시판을 지정해야 합니다.');
        return;
      }
      syncEditorToHidden(editor, hidden);
      if (!isMeaningfulHtml(hidden.value)) {
        e.preventDefault();
        window.alert('본문을 입력하거나 이미지·동영상·YouTube를 추가해주세요.');
      }
    });
  });
})();
