/**
 * 마이페이지 메인 설정: 게시물 작성 페이지와 동일한 서식(글꼴·크기·색·정렬 등) 두 개(sn / bio).
 */
(function () {
  'use strict';

  const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 26, 28, 30, 36, 42, 50, 72, 96];

  /** 색 격자 (게시글 편집기와 동일) */
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

  function escapeHtmlText(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/'/g, '&#39;')
      .replace(/"/g, '&quot;');
  }

  function looksLikeRichHtml(str) {
    return typeof str === 'string' && /<\s*[a-z][\s\S]*>/i.test(str);
  }

  function syncEditorToHidden(editor, hidden) {
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('.post-editor-guide-inline').forEach(function (n) {
      n.remove();
    });
    hidden.value = clone.innerHTML;
  }

  function getPlainTextSansGuide(editor) {
    const clone = editor.cloneNode(true);
    clone.querySelectorAll('.post-editor-guide-inline').forEach(function (n) {
      n.remove();
    });
    return clone.textContent.replace(/\u00a0/g, ' ').replace(/\u200b/g, '').replace(/\s+/g, ' ').trim();
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
      } catch (_e) {
        btn.classList.remove('is-active');
      }
    });
  }

  function snapToPreset(px) {
    const n = parseInt(px, 10);
    if (Number.isNaN(n)) return 10;
    let best = FONT_SIZE_PRESETS[0];
    let bd = Infinity;
    for (let i = 0; i < FONT_SIZE_PRESETS.length; i += 1) {
      const p = FONT_SIZE_PRESETS[i];
      const d = Math.abs(p - n);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  const floatingApis = [];

  function attachOne(opts) {
    const cfg = window.__MYPAGE_MAIN_SETTINGS__;
    if (!cfg) return null;

    const {
      sx,
      initialHtmlKey,
      placeholder,
      hidden,
      editor,
      requireNonempty,
      form
    } = opts;

    if (!sx || !editor || !hidden) return null;

    const fmtBar = document.getElementById('mypageFmtBar' + sx);
    const selFont = document.getElementById('mypageFmtFontFamily' + sx);
    const sizeWrap = document.getElementById('mypageFmtFontSizeWrap' + sx);
    const sizeTrigger = document.getElementById('mypageFmtFontSizeTrigger' + sx);
    const sizeMenu = document.getElementById('mypageFmtFontSizeMenu' + sx);
    const sizeValue = document.getElementById('mypageFmtFontSizeValue' + sx);
    const colorBtn = document.getElementById('mypageFmtColorBtn' + sx);
    const colorPanel = document.getElementById('mypageFmtColorPanel' + sx);
    const fgGrid = document.getElementById('mypageFmtFgGrid' + sx);
    const bgGrid = document.getElementById('mypageFmtBgGrid' + sx);
    const fgPicker = document.getElementById('mypageFmtFgColorHidden' + sx);
    const bgPicker = document.getElementById('mypageFmtBgColorHidden' + sx);

    let savedEditorRange = null;
    function saveEditorSelection() {
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
    function restoreEditorSelection() {
      if (!editor || !savedEditorRange) return false;
      try {
        if (!editor.contains(savedEditorRange.commonAncestorContainer)) return false;
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(savedEditorRange);
        editor.focus();
        return true;
      } catch (_err0) {
        savedEditorRange = null;
        return false;
      }
    }
    function clearStoredSelection() {
      savedEditorRange = null;
    }
    function applyInlineStyleLocal(prop, value) {
      restoreEditorSelection();
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
      } catch (_err1) {
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
    function execRtfLocal(cmd, val) {
      restoreEditorSelection();
      clearStoredSelection();
      editor.focus();
      try {
        document.execCommand('styleWithCSS', false, true);
      } catch (_e1) {
        /* ignore */
      }
      try {
        if (val === undefined) document.execCommand(cmd, false);
        else document.execCommand(cmd, false, val);
      } catch (_e2) {
        /* ignore */
      }
    }

    const rootWrap = fmtBar ? fmtBar.parentElement : editor.parentElement;

    const rawInitial = cfg[initialHtmlKey] != null ? String(cfg[initialHtmlKey]) : '';
    function applyInitialDom() {
      const t = rawInitial.trim();
      if (t && looksLikeRichHtml(t)) {
        editor.innerHTML = t;
      } else if (t) {
        editor.innerHTML = '<p>' + escapeHtmlText(t).replace(/\n/g, '<br>') + '</p>';
      } else if (sx === 'Sn' && placeholder) {
        editor.innerHTML =
          '<p class="post-editor-first-line">' +
          '<span class="post-editor-guide-inline" contenteditable="false">' +
          escapeHtmlText(placeholder) +
          '</span><br></p>';
      } else {
        editor.innerHTML =
          '<p class="post-editor-first-line">' +
          '<span class="post-editor-guide-inline" contenteditable="false">' +
          escapeHtmlText(placeholder || '') +
          '</span><br></p>';
      }
    }
    applyInitialDom();
    syncEditorToHidden(editor, hidden);

    function removeGuideSpan() {
      editor.querySelectorAll('.post-editor-guide-inline').forEach(function (n) {
        n.remove();
      });
    }

    function applyPlaceholderClass() {
      const hasGuide = !!editor.querySelector('.post-editor-guide-inline');
      const tlen = getPlainTextSansGuide(editor).length;
      editor.classList.toggle('post-editor-body--empty', tlen === 0 && !hasGuide);
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
      } catch (_e2) {
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
      removeGuideSpan();
      applyPlaceholderClass();
    });

    editor.addEventListener('input', function () {
      const g = editor.querySelector('.post-editor-guide-inline');
      if (g && getPlainTextSansGuide(editor).length > 0) removeGuideSpan();
      applyPlaceholderClass();
      if (fmtBar) refreshFmtButtonStates(fmtBar, editor);
      syncEditorToHidden(editor, hidden);
    });

    let selTimer;
    document.addEventListener('selectionchange', function () {
      clearTimeout(selTimer);
      selTimer = setTimeout(function () {
        if (fmtBar) refreshFmtButtonStates(fmtBar, editor);
      }, 80);
    });

    let selectedFontSizePxLocal = 10;

    function closeFontSizeMenu() {
      if (!sizeMenu || !sizeTrigger) return;
      sizeMenu.classList.add('is-hidden');
      sizeTrigger.setAttribute('aria-expanded', 'false');
    }

    function openFontSizeMenu() {
      if (!sizeMenu || !sizeTrigger) return;
      floatingApis.forEach(function (x) {
        if (x !== api) x.closeFloaters();
      });
      sizeMenu.classList.remove('is-hidden');
      sizeTrigger.setAttribute('aria-expanded', 'true');
    }

    function toggleFontSizeMenu() {
      if (!sizeMenu) return;
      if (sizeMenu.classList.contains('is-hidden')) openFontSizeMenu();
      else closeFontSizeMenu();
    }

    function syncFontSizeMenuSelection() {
      if (!sizeMenu) return;
      sizeMenu.querySelectorAll('.post-editor-fmt-size-option').forEach(function (btn) {
        const px = Number(btn.getAttribute('data-px'));
        const sel = px === selectedFontSizePxLocal;
        btn.setAttribute('aria-selected', sel ? 'true' : 'false');
        btn.classList.toggle('is-selected', sel);
      });
    }

    function setFontSizeDisplay(px) {
      selectedFontSizePxLocal = snapToPreset(px);
      if (sizeValue) sizeValue.textContent = String(selectedFontSizePxLocal);
      syncFontSizeMenuSelection();
    }

    function applyFontSize(px) {
      const p = FONT_SIZE_PRESETS.indexOf(px) >= 0 ? px : snapToPreset(px);
      setFontSizeDisplay(p);
      applyInlineStyleLocal('fontSize', p + 'px');
      syncEditorToHidden(editor, hidden);
    }

    function buildFontSizeMenu() {
      if (!sizeMenu) return;
      sizeMenu.textContent = '';
      const frag = document.createDocumentFragment();
      FONT_SIZE_PRESETS.forEach(function (px) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'post-editor-fmt-size-option';
        b.setAttribute('role', 'option');
        b.setAttribute('data-px', String(px));
        b.setAttribute('aria-selected', 'false');
        const check = document.createElement('span');
        check.className = 'post-editor-fmt-size-option-check';
        check.setAttribute('aria-hidden', 'true');
        check.innerHTML = '<i class="fas fa-check"></i>';
        const num = document.createElement('span');
        num.className = 'post-editor-fmt-size-option-num';
        num.textContent = String(px);
        b.appendChild(check);
        b.appendChild(num);
        frag.appendChild(b);
      });
      sizeMenu.appendChild(frag);
    }

    if (sizeMenu && sizeTrigger && sizeValue) {
      buildFontSizeMenu();
      setFontSizeDisplay(10);
      sizeTrigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleFontSizeMenu();
      });
      sizeMenu.addEventListener('click', function (e) {
        const opt = e.target.closest('.post-editor-fmt-size-option');
        if (!opt) return;
        e.preventDefault();
        const px = Number(opt.getAttribute('data-px'));
        if (!Number.isFinite(px)) return;
        restoreEditorSelection();
        clearStoredSelection();
        editor.focus();
        applyFontSize(px);
        closeFontSizeMenu();
      });
    }

    function closeColorPanelFn() {
      if (!colorPanel) return;
      colorPanel.classList.add('is-hidden');
      if (colorBtn) colorBtn.setAttribute('aria-expanded', 'false');
    }

    function openColorPanel() {
      if (!colorPanel) return;
      floatingApis.forEach(function (x) {
        if (x !== api) x.closeFloaters();
      });
      closeFontSizeMenu();
      colorPanel.classList.remove('is-hidden');
      if (colorBtn) colorBtn.setAttribute('aria-expanded', 'true');
    }

    function toggleColorPanelFn() {
      if (!colorPanel) return;
      if (colorPanel.classList.contains('is-hidden')) openColorPanel();
      else closeColorPanelFn();
    }

    function applyColor(kind, hex) {
      if (kind === 'fg') {
        execRtfLocal('foreColor', hex);
      } else {
        try {
          document.execCommand('styleWithCSS', false, true);
        } catch (_e1) {
          /* */
        }
        if (String(hex).toLowerCase() === 'transparent') {
          try {
            document.execCommand('hiliteColor', false, 'transparent');
          } catch (_e2) {
            applyInlineStyleLocal('backgroundColor', 'transparent');
          }
        } else {
          execRtfLocal('hiliteColor', hex);
        }
      }
      syncEditorToHidden(editor, hidden);
      closeColorPanelFn();
    }

    if (fgGrid && bgGrid) {
      buildSwatchGrid(fgGrid, 'fg');
      buildSwatchGrid(bgGrid, 'bg');
    }

    if (fmtBar) {
      fmtBar.addEventListener(
        'mousedown',
        function () {
          saveEditorSelection();
        },
        true
      );

      fmtBar.addEventListener('mousedown', function (e) {
        if (
          e.target.closest &&
          (e.target.closest('button.post-editor-fmt-btn') ||
            e.target.closest('[id^="mypageFmtColorBtn"]') ||
            e.target.closest('[id^="mypageFmtFontSizeTrigger"]'))
        ) {
          e.preventDefault();
        }
      });

      fmtBar.addEventListener('click', function (e) {
        const cmdBtn = e.target.closest('[data-cmd]');
        if (cmdBtn) {
          const cmd = cmdBtn.getAttribute('data-cmd');
          execRtfLocal(cmd);
          syncEditorToHidden(editor, hidden);
          refreshFmtButtonStates(fmtBar, editor);
          return;
        }
        const jBtn = e.target.closest('[data-justify]');
        if (jBtn) {
          const j = jBtn.getAttribute('data-justify');
          const map = { left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight' };
          if (map[j]) execRtfLocal(map[j]);
          syncEditorToHidden(editor, hidden);
        }
      });
    }

    if (selFont) {
      selFont.addEventListener('change', function () {
        const v = this.value;
        if (!v) return;
        applyInlineStyleLocal('fontFamily', v);
        this.selectedIndex = 0;
        syncEditorToHidden(editor, hidden);
      });
    }

    if (colorBtn && colorPanel) {
      colorBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        toggleColorPanelFn();
      });
    }

    if (colorPanel) {
      colorPanel.addEventListener('click', function (e) {
        const sw = e.target.closest('.post-editor-swatch');
        if (sw) {
          e.preventDefault();
          applyColor(sw.getAttribute('data-kind'), sw.getAttribute('data-hex'));
          return;
        }
        const presetEl = e.target.closest('[data-color-action]');
        if (presetEl) {
          e.preventDefault();
          const act = presetEl.getAttribute('data-color-action');
          if (act === 'fg-black') applyColor('fg', '#000000');
          else if (act === 'bg-transparent') applyColor('bg', 'transparent');
          return;
        }
        const more = e.target.closest('[data-color-more]');
        if (!more) return;
        e.preventDefault();
        const k = more.getAttribute('data-color-more');
        if (k === 'fg' && fgPicker) fgPicker.click();
        else if (k === 'bg' && bgPicker) bgPicker.click();
      });
    }

    if (fgPicker) {
      fgPicker.addEventListener('input', function () {
        editor.focus();
        execRtfLocal('foreColor', fgPicker.value);
        syncEditorToHidden(editor, hidden);
        closeColorPanelFn();
      });
    }
    if (bgPicker) {
      bgPicker.addEventListener('input', function () {
        editor.focus();
        try {
          document.execCommand('styleWithCSS', false, true);
        } catch (_e1) {
          /* */
        }
        execRtfLocal('hiliteColor', bgPicker.value);
        syncEditorToHidden(editor, hidden);
        closeColorPanelFn();
      });
    }

    editor.addEventListener('keydown', function (e) {
      if (!e.ctrlKey && !e.metaKey) return;
      const k = String(e.key || '').toLowerCase();
      if (!fmtBar) return;
      if (k === 'b') {
        e.preventDefault();
        execRtfLocal('bold');
        refreshFmtButtonStates(fmtBar, editor);
        syncEditorToHidden(editor, hidden);
      } else if (k === 'i') {
        e.preventDefault();
        execRtfLocal('italic');
        refreshFmtButtonStates(fmtBar, editor);
        syncEditorToHidden(editor, hidden);
      } else if (k === 'u') {
        e.preventDefault();
        execRtfLocal('underline');
        refreshFmtButtonStates(fmtBar, editor);
        syncEditorToHidden(editor, hidden);
      }
    });

    const api = {
      root: rootWrap || editor,
      editor: editor,
      hidden: hidden,
      closeColorPanel: closeColorPanelFn,
      closeFloaters: function () {
        closeFontSizeMenu();
        closeColorPanelFn();
      }
    };

    floatingApis.push(api);

    if (form) {
      form.addEventListener('submit', function () {
        removeGuideSpan();
        syncEditorToHidden(editor, hidden);
      });
      if (requireNonempty) {
        form.addEventListener(
          'submit',
          function (e) {
            syncEditorToHidden(editor, hidden);
            if (!getPlainTextSansGuide(editor).length) {
              e.preventDefault();
              window.alert('메인 페이지 표기 이름을 입력해 주세요.');
            }
          },
          true
        );
      }
    }

    return api;
  }

  let globalsBound = false;
  function bindGlobalFloatersOnce() {
    if (globalsBound) return;
    globalsBound = true;
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      floatingApis.forEach(function (a) {
        a.closeFloaters();
      });
    });
    document.addEventListener('mousedown', function (e) {
      floatingApis.forEach(function (a) {
        if (!a.root.contains(e.target)) {
          a.closeFloaters();
        }
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    const cfg = window.__MYPAGE_MAIN_SETTINGS__;
    const form = document.getElementById('mypageMainSettingsForm');
    const edSn = document.getElementById('mypageEditorSn');
    const hiSn = document.getElementById('mypageHiddenSn');
    const edBio = document.getElementById('mypageEditorBio');
    const hiBio = document.getElementById('mypageHiddenBio');

    if (!cfg || !form || !edSn || !hiSn || !edBio || !hiBio) return;

    bindGlobalFloatersOnce();

    const defaultPlaceholder = 'Donghawan Lee / @lilip';
    attachOne({
      sx: 'Sn',
      initialHtmlKey: 'site_name',
      placeholder:
        cfg.site_name &&
        typeof cfg.site_name === 'string' &&
        cfg.site_name.trim() &&
        !looksLikeRichHtml(cfg.site_name)
          ? cfg.site_name.trim()
          : defaultPlaceholder,
      hidden: hiSn,
      editor: edSn,
      form: form,
      requireNonempty: true
    });

    attachOne({
      sx: 'Bio',
      initialHtmlKey: 'bio',
      placeholder: '내용을 입력하세요.',
      hidden: hiBio,
      editor: edBio,
      form: form,
      requireNonempty: false
    });
  });
})();
