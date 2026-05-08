(function () {
  var jump = document.getElementById('postCommentJumpBtn');
  var commentsEl = document.getElementById('comments');
  if (jump && commentsEl) {
    jump.addEventListener('click', function () {
      commentsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  var mainForm = document.getElementById('mainCommentForm');
  var ta = document.getElementById('commentMainTextarea');
  var charCount = document.getElementById('commentCharCount');

  function syncCharCount() {
    if (!ta || !charCount) return;
    charCount.textContent = (ta.value || '').length + ' / 100';
  }

  if (ta && charCount && mainForm) {
    ta.addEventListener('input', syncCharCount);
    syncCharCount();
    mainForm.addEventListener('submit', function () {
      if ((ta.value || '').length > 100) {
        ta.value = (ta.value || '').slice(0, 100);
      }
    });
  }

  var commentsSection = document.getElementById('comments');
  if (!commentsSection) return;

  commentsSection.addEventListener('input', function (e) {
    if (e.target.classList && e.target.classList.contains('comment-textarea--edit')) {
      var v = e.target.value || '';
      if (v.length > 100) e.target.value = v.slice(0, 100);
    }
  });

  commentsSection.addEventListener('click', function (e) {
    var openEdit = e.target.closest('.comment-edit-open');
    if (openEdit) {
      var cid = openEdit.getAttribute('data-comment-id');
      var view = document.getElementById('comment-view-' + cid);
      var editForm = document.getElementById('comment-edit-' + cid);
      if (view && editForm) {
        view.classList.add('is-hidden');
        editForm.classList.remove('is-hidden');
        var et = editForm.querySelector('textarea');
        if (et) et.focus();
      }
      return;
    }

    var cancelEdit = e.target.closest('.comment-edit-cancel');
    if (cancelEdit) {
      var cid2 = cancelEdit.getAttribute('data-comment-id');
      var view2 = document.getElementById('comment-view-' + cid2);
      var editForm2 = document.getElementById('comment-edit-' + cid2);
      if (view2 && editForm2) {
        editForm2.classList.add('is-hidden');
        view2.classList.remove('is-hidden');
      }
    }
  });

  var dlg = document.getElementById('postWriteGuideDialog');
  var openBtn = document.getElementById('postWriteGuideBtn');
  var closeBtn = document.getElementById('postWriteGuideClose');
  if (dlg && openBtn) {
    openBtn.addEventListener('click', function () {
      if (dlg.showModal) dlg.showModal();
    });
  }
  if (dlg && closeBtn) {
    closeBtn.addEventListener('click', function () {
      dlg.close();
    });
  }
})();
