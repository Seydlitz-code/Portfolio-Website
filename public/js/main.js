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
    var heroSnapLockUntil = 0;
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

    /* ---- upward scroll assist: portfolio-top lock → hero snap ---- */
    var upwardLockedAtBreakpoint = false;
    var upwardLockThrottleUntil = 0;
    var upLastKnownY = window.scrollY;
    var BREAKPOINT_ZONE = 80;

    window.addEventListener('scroll', function () {
      upLastKnownY = window.scrollY;
    }, { passive: true });

    window.addEventListener('resize', function () {
      upwardLockedAtBreakpoint = false;
    }, { passive: true });

    window.addEventListener(
      'wheel',
      function (e) {
        if (e.deltaY >= 0) {
          upwardLockedAtBreakpoint = false;
          return;
        }

        var y = window.scrollY;
        var vh = window.innerHeight;
        var bar = measureDockedTopnavHeight();
        var breakPointY = Math.max(0, hero.offsetHeight - bar);

        if (y >= vh + 6) {
          upwardLockedAtBreakpoint = false;
        }

        var now = performance.now();
        if (now < upwardLockThrottleUntil) return;

        if (upwardLockedAtBreakpoint && Math.abs(y - breakPointY) < 4) {
          upwardLockedAtBreakpoint = false;
          upwardLockThrottleUntil = now + 800;
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }

        if (!upwardLockedAtBreakpoint && y > breakPointY && y <= breakPointY + BREAKPOINT_ZONE) {
          upwardLockedAtBreakpoint = true;
          upwardLockThrottleUntil = now + 500;
          e.preventDefault();
          window.scrollTo({ top: breakPointY, behavior: 'smooth' });
          return;
        }

        if (y < breakPointY) {
          upwardLockedAtBreakpoint = false;
        }
      },
      { passive: false }
    );

    /* ---- touch: upward scroll assist ---- */
    var touchStartY = 0;
    var touchStartScrollY = 0;

    window.addEventListener('touchstart', function (e) {
      if (e.touches.length === 1) {
        touchStartY = e.touches[0].clientY;
        touchStartScrollY = window.scrollY;
      }
    }, { passive: true });

    window.addEventListener('touchend', function () {
      var y = window.scrollY;
      var bar = measureDockedTopnavHeight();
      var breakPointY = Math.max(0, hero.offsetHeight - bar);
      var dist = touchStartScrollY - y;

      if (dist < 4) return;

      if (upwardLockedAtBreakpoint && Math.abs(y - breakPointY) < 4) {
        upwardLockedAtBreakpoint = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (!upwardLockedAtBreakpoint && y > breakPointY && y <= breakPointY + BREAKPOINT_ZONE) {
        upwardLockedAtBreakpoint = true;
        window.scrollTo({ top: breakPointY, behavior: 'smooth' });
        return;
      }

      if (y < breakPointY) {
        upwardLockedAtBreakpoint = false;
      }
    }, { passive: true });
  }
})();

function scrollToHero(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToPortfolio(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  var portfolio = document.getElementById('portfolio');
  if (portfolio) {
    portfolio.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
