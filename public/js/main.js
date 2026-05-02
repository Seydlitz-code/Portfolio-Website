/* ========================================
   SCROLL — 히어로 페이드 + 상단바(포트폴리오 구간 도킹)
   ======================================== */
(function () {
  const hero = document.getElementById('hero');
  const portfolio = document.getElementById('portfolio');
  const topnav = document.getElementById('topnav');
  if (!hero || !portfolio) return;

  const indexPage = document.body.classList.contains('index-page');

  function onScroll() {
    const scrollY = window.scrollY;
    const vh = window.innerHeight;
    const opacity = Math.max(0, 1 - scrollY / (vh * 0.6));
    hero.style.opacity = opacity;
    hero.style.pointerEvents = opacity < 0.1 ? 'none' : 'all';

    // 포트폴리오가 눈에 들어오기 시작하면 상단바(배경 + 가운데 사이트명) 표시
    const pastMain = scrollY >= vh * (indexPage ? 0.48 : 0.92);
    if (topnav) {
      topnav.classList.toggle('topnav--dock-phase', pastMain);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /** 도킹 상단바 높이(px) — 스크롤 스냅 시 첫 게시판이 바에 가리지 않도록 보정 */
  function measureDockedTopnavHeight() {
    if (!topnav) return 56;
    const hadDock = topnav.classList.contains('topnav--dock-phase');
    topnav.classList.add('topnav--dock-phase');
    void topnav.offsetHeight;
    const h = topnav.offsetHeight;
    topnav.classList.toggle('topnav--dock-phase', hadDock);
    return Math.max(Math.round(h), 48);
  }

  // 메인(히어로)에서 아래로 스크롤할 때 포트폴리오 첫 블록이 고정 상단바 아래에 오도록 정렬
  if (indexPage) {
    let heroSnapLockUntil = 0;
    window.addEventListener(
      'wheel',
      function (e) {
        const y = window.scrollY;
        const vh = window.innerHeight;
        const bar = measureDockedTopnavHeight();
        const targetTop = Math.max(0, hero.offsetHeight - bar);
        if (y >= vh - 20) return;
        if (e.deltaY <= 0) return;
        if (Math.abs(y - targetTop) < 16) return;
        const now = performance.now();
        if (now < heroSnapLockUntil) return;
        heroSnapLockUntil = now + 780;
        e.preventDefault();
        window.scrollTo({ top: targetTop, behavior: 'smooth' });
      },
      { passive: false }
    );
  }
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
