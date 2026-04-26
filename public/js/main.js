/* ========================================
   SCROLL ANIMATION — Hero fade out
   ======================================== */
(function () {
  const hero = document.getElementById('hero');
  const portfolio = document.getElementById('portfolio');
  if (!hero || !portfolio) return;

  function onScroll() {
    const scrollY = window.scrollY;
    const vh = window.innerHeight;
    // Hero fades out over 60% of viewport height of scroll
    const opacity = Math.max(0, 1 - scrollY / (vh * 0.6));
    hero.style.opacity = opacity;

    // Pointer events: disable hero clicks when almost gone
    hero.style.pointerEvents = opacity < 0.1 ? 'none' : 'all';
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // run once on load
})();

/* ========================================
   SCROLL BACK TO HERO
   ======================================== */
function scrollToHero() {
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
