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

    const pastMain = scrollY >= vh * (indexPage ? 0.48 : 0.92);
    if (topnav) {
      topnav.classList.toggle('topnav--dock-phase', pastMain);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  function measureDockedTopnavHeight() {
    if (!topnav) return 56;
    const hadDock = topnav.classList.contains('topnav--dock-phase');
    topnav.classList.add('topnav--dock-phase');
    void topnav.offsetHeight;
    const h = topnav.offsetHeight;
    topnav.classList.toggle('topnav--dock-phase', hadDock);
    return Math.max(Math.round(h), 48);
  }

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

function scrollToHero(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
