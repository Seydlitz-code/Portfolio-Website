/* ========================================
   SCROLL — 히어로 페이드 + 포트폴리오 상단 바(메인 이후에만 표시)
   ======================================== */
(function () {
  const hero = document.getElementById('hero');
  const portfolio = document.getElementById('portfolio');
  const dock = document.getElementById('portfolioDockHeader');
  if (!hero || !portfolio) return;

  function onScroll() {
    const scrollY = window.scrollY;
    const vh = window.innerHeight;
    const opacity = Math.max(0, 1 - scrollY / (vh * 0.6));
    hero.style.opacity = opacity;
    hero.style.pointerEvents = opacity < 0.1 ? 'none' : 'all';

    // 메인(히어로) 영역을 넘어 포트폴리오로 들어온 뒤에만 상단 바 표시
    const pastMain = scrollY >= vh * 0.92;
    if (dock) {
      dock.classList.toggle('portfolio-dock-header--visible', pastMain);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ========================================
   SCROLL BACK TO HERO (새로고침 없이 부드러운 스크롤)
   ======================================== */
function scrollToHero(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ========================================
   INLINE EDIT TOGGLE
   ======================================== */
function toggleEdit(editId, displayId) {
  const editEl = document.getElementById(editId);
  const displayEl = document.getElementById(displayId);
  if (!editEl || !displayEl) return;

  const isHidden = editEl.style.display === 'none' || editEl.style.display === '';
  editEl.style.display = isHidden ? 'flex' : 'none';
  displayEl.style.display = isHidden ? 'none' : 'flex';

  if (isHidden) {
    const input = editEl.querySelector('input[type=text], textarea');
    if (input) input.focus();
  }
}

/* ========================================
   MODAL
   ======================================== */
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

// Close modal on Escape key
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(el => {
      if (el.style.display !== 'none') closeModal(el.id);
    });
  }
});
