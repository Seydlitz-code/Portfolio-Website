/**
 * 관리 마이페이지(/mypage) 등 — .modal-overlay 토글 (프로젝트 추가 등)
 */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.style.display = 'none';
    document.body.style.overflow = '';
  }
}

function closeModalOnOverlay(event, id) {
  if (event.target.id === id) closeModal(id);
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(function (el) {
      if (el.style.display !== 'none') closeModal(el.id);
    });
  }
});
