/**
 * 마이페이지 — 게시판 생성&삭제: 생성 모달, 삭제 확인·차단
 */
(function () {
  const LABEL_KO = '게시판 국문 이름';
  const LABEL_JA = '게시판 일문 이름';
  const LABEL_DESC = '게시판 소개';

  function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'flex';
  }

  function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  function closeModalOnOverlay(ev, id) {
    if (ev.target.id === id) closeModal(id);
  }

  window.closeModalOnOverlay = closeModalOnOverlay;

  window.openCreateBoardModal = function () {
    const err = document.getElementById('createBoardFormError');
    if (err) {
      err.textContent = '';
      err.style.display = 'none';
    }
    openModal('createBoardModal');
  };

  window.closeCreateBoardModal = function () {
    closeModal('createBoardModal');
  };

  function validateCreateForm() {
    const err = document.getElementById('createBoardFormError');
    const name = (document.getElementById('createBoardNameKo') || {}).value;
    const nameJa = (document.getElementById('createBoardNameJa') || {}).value;
    const desc = (document.getElementById('createBoardDesc') || {}).value;
    const missing = [];
    if (!name || !String(name).trim()) missing.push(LABEL_KO);
    if (!nameJa || !String(nameJa).trim()) missing.push(LABEL_JA);
    if (!desc || !String(desc).trim()) missing.push(LABEL_DESC);
    if (missing.length === 0) return true;
    const part = missing.join(', ');
    if (err) {
      err.textContent = '(' + part + ')을(를) 작성하지 않아 게시판을 생성할 수 없습니다.';
      err.style.display = 'block';
    }
    return false;
  }

  const createForm = document.getElementById('createBoardForm');
  if (createForm) {
    createForm.addEventListener('submit', function (e) {
      if (!validateCreateForm()) e.preventDefault();
    });
  }

  const deleteForm = document.getElementById('mypageBoardDeleteForm');

  window.openBoardDeleteConfirm = function (projectId, postCount) {
    window.__pendingBoardDelete = { projectId: projectId, postCount: Number(postCount) || 0 };
    if (deleteForm) {
      deleteForm.action = '/admin/projects/' + projectId;
    }
    openModal('boardDeleteConfirmModal');
  };

  window.closeBoardDeleteConfirm = function () {
    closeModal('boardDeleteConfirmModal');
    window.__pendingBoardDelete = null;
  };

  window.confirmBoardDeleteSubmit = function () {
    const p = window.__pendingBoardDelete;
    if (!p || !deleteForm) return;
    if (p.postCount > 0) {
      closeModal('boardDeleteConfirmModal');
      openModal('boardDeleteBlockedModal');
      window.__pendingBoardDelete = null;
      return;
    }
    deleteForm.submit();
  };

  window.closeBoardDeleteBlocked = function () {
    closeModal('boardDeleteBlockedModal');
    window.location.href = '/mypage/boards';
  };

  document.querySelectorAll('[data-board-delete]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const id = btn.getAttribute('data-board-delete');
      const posts = btn.getAttribute('data-post-count') || '0';
      window.openBoardDeleteConfirm(id, posts);
    });
  });

  const params = new URLSearchParams(window.location.search);
  if (params.get('deleteBlocked') === '1') {
    openModal('boardDeleteBlockedModal');
  }
  if (params.get('createErr') === '1') {
    const err = document.getElementById('createBoardFormError');
    if (err) {
      err.textContent = '필수 항목을 모두 입력해 주세요.';
      err.style.display = 'block';
    }
    openModal('createBoardModal');
  }
})();
