// ---------- State ----------
let CATEGORIES = [];
let activeCategoryIndex = -1;   // -1 = rotation mode (no category open)
let rotationIndex = 0;
let rotationTimer = null;
let lightboxImages = [];

// DOM refs set during init
let heroBgA, heroBgB, heroShowingA = true;

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const resp = await fetch('works.json');
    CATEGORIES = await resp.json();
  } catch (e) {
    console.error('Failed to load works.json', e);
    return;
  }
  if (!CATEGORIES.length) return;

  initHeroBgs();
  buildCategoryNav();
  showHeroImage(CATEGORIES[0].featured);
  startRotation();
});

// ---------- Hero background layers ----------
function initHeroBgs() {
  heroBgA = document.querySelector('.hero-bg--a');
  heroBgB = document.querySelector('.hero-bg--b');
  if (!heroBgA || !heroBgB) return;
  heroBgA.style.opacity = '1';
  heroBgB.style.opacity = '0';
  heroShowingA = true;
}

function showHeroImage(src) {
  if (!heroBgA || !heroBgB) return;
  if (heroShowingA) {
    heroBgB.style.backgroundImage = 'url("' + src + '")';
    heroBgB.style.opacity = '1';
    heroBgA.style.opacity = '0';
  } else {
    heroBgA.style.backgroundImage = 'url("' + src + '")';
    heroBgA.style.opacity = '1';
    heroBgB.style.opacity = '0';
  }
  heroShowingA = !heroShowingA;
}

// ---------- Category nav ----------
function buildCategoryNav() {
  const nav = document.getElementById('cat-nav');
  if (!nav) return;

  CATEGORIES.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.className = 'cat-nav-btn';
    btn.textContent = cat.label;
    btn.dataset.index = i;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      selectCategory(i);
    });
    nav.appendChild(btn);
  });

  highlightNavItem(0);
}

function highlightNavItem(index) {
  const btns = document.querySelectorAll('.cat-nav-btn');
  btns.forEach((b, i) => {
    b.classList.toggle('cat-nav-btn--active', i === index);
  });
}

// ---------- Auto-rotation ----------
function startRotation() {
  stopRotation();
  rotationTimer = setInterval(advanceRotation, 4500);

  document.addEventListener('visibilitychange', handleVisibility);
}

function stopRotation() {
  if (rotationTimer) {
    clearInterval(rotationTimer);
    rotationTimer = null;
  }
}

function advanceRotation() {
  rotationIndex = (rotationIndex + 1) % CATEGORIES.length;
  showHeroImage(CATEGORIES[rotationIndex].featured);
  highlightNavItem(rotationIndex);
}

function handleVisibility() {
  if (document.hidden) {
    stopRotation();
  } else if (activeCategoryIndex === -1) {
    startRotation();
  }
}

// ---------- Category selection ----------
function selectCategory(index) {
  const hero = document.querySelector('.hero');
  const identity = document.getElementById('hero-identity');
  const gallery = document.querySelector('.gallery-section');

  // Close if same category clicked again
  if (activeCategoryIndex === index) {
    closeCategory();
    return;
  }

  // Open category
  activeCategoryIndex = index;
  stopRotation();

  // Update hero
  showHeroImage(CATEGORIES[index].featured);
  highlightNavItem(index);
  if (hero) hero.classList.add('hero--category-open');
  if (identity) identity.classList.add('hero-identity--hidden');

  // Build gallery
  buildGallery(CATEGORIES[index]);
  if (gallery) gallery.classList.add('gallery--open');

  // Scroll gallery into view after hero shrinks
  setTimeout(() => {
    if (gallery) gallery.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 350);
}

function closeCategory() {
  const hero = document.querySelector('.hero');
  const identity = document.getElementById('hero-identity');
  const gallery = document.querySelector('.gallery-section');

  activeCategoryIndex = -1;
  if (hero) hero.classList.remove('hero--category-open');
  if (identity) identity.classList.remove('hero-identity--hidden');
  if (gallery) gallery.classList.remove('gallery--open');

  // Resume rotation from current position
  startRotation();
}

// ---------- Gallery ----------
function buildGallery(cat) {
  const grid = document.getElementById('gallery-grid');
  const title = document.getElementById('gallery-title');
  const closeBtn = document.getElementById('gallery-close');
  if (!grid) return;

  // Set header
  if (title) title.textContent = cat.label;
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closeCategory();
    };
  }

  // Clear existing
  grid.innerHTML = '';
  lightboxImages = cat.images;

  const frag = document.createDocumentFragment();

  cat.images.forEach((src, index) => {
    const figure = document.createElement('figure');
    figure.className = 'piece';

    const img = document.createElement('img');
    img.className = 'piece-img';
    img.src = src;
    img.alt = cat.label + ' artwork';
    img.loading = 'lazy';
    img.onerror = () => {
      figure.classList.add('piece--missing');
      img.remove();
    };

    figure.appendChild(img);
    figure.addEventListener('click', () => openLightbox(index));
    frag.appendChild(figure);
  });

  grid.appendChild(frag);
  observePieces();
}

// ---------- Lightbox ----------
let lightboxEl = null;
let lightboxImgA = null;
let lightboxImgB = null;
let lightboxIndex = 0;
let lightboxShowingA = true;

function createLightbox() {
  lightboxEl = document.createElement('div');
  lightboxEl.className = 'lightbox';
  lightboxEl.innerHTML = `
    <div class="lightbox-backdrop"></div>
    <button class="lightbox-close" aria-label="Close">&times;</button>
    <button class="lightbox-prev" aria-label="Previous">&lsaquo;</button>
    <button class="lightbox-next" aria-label="Next">&rsaquo;</button>
    <div class="lightbox-stage">
      <img class="lightbox-img lightbox-img--a" src="" alt="">
      <img class="lightbox-img lightbox-img--b" src="" alt="">
    </div>
  `;
  document.body.appendChild(lightboxEl);

  lightboxImgA = lightboxEl.querySelector('.lightbox-img--a');
  lightboxImgB = lightboxEl.querySelector('.lightbox-img--b');

  lightboxImgA.style.opacity = '1';
  lightboxImgB.style.opacity = '0';

  lightboxEl.querySelector('.lightbox-backdrop').addEventListener('click', closeLightbox);
  lightboxEl.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
  lightboxEl.querySelector('.lightbox-prev').addEventListener('click', (e) => {
    e.stopPropagation();
    navigateLightbox(-1);
  });
  lightboxEl.querySelector('.lightbox-next').addEventListener('click', (e) => {
    e.stopPropagation();
    navigateLightbox(1);
  });

  document.addEventListener('keydown', (e) => {
    if (!lightboxEl.classList.contains('lightbox--open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') navigateLightbox(-1);
    if (e.key === 'ArrowRight') navigateLightbox(1);
  });

  // Touch swipe support
  let touchStartX = 0;
  let touchStartY = 0;
  let touchDeltaX = 0;
  let touchDeltaY = 0;
  let swipeDirection = null;

  lightboxEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchDeltaX = 0;
    touchDeltaY = 0;
    swipeDirection = null;
  }, { passive: true });

  lightboxEl.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;

    if (!swipeDirection && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      swipeDirection = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
    }
    if (swipeDirection) {
      e.preventDefault();
      touchDeltaX = dx;
      touchDeltaY = dy;
    }
  }, { passive: false });

  lightboxEl.addEventListener('touchend', () => {
    if (swipeDirection === 'horizontal' && Math.abs(touchDeltaX) > 40) {
      navigateLightbox(touchDeltaX < 0 ? 1 : -1);
    } else if (swipeDirection === 'vertical' && Math.abs(touchDeltaY) > 40) {
      navigateLightbox(touchDeltaY < 0 ? 1 : -1);
    }
    swipeDirection = null;
    touchDeltaX = 0;
    touchDeltaY = 0;
  }, { passive: true });
}

function openLightbox(index) {
  if (!lightboxEl) createLightbox();
  lightboxIndex = index;
  const src = lightboxImages[lightboxIndex];
  lightboxImgA.src = src;
  lightboxImgA.alt = 'Artwork';
  lightboxImgA.style.opacity = '1';
  lightboxImgB.style.opacity = '0';
  lightboxShowingA = true;
  lightboxEl.classList.add('lightbox--open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  lightboxEl.classList.remove('lightbox--open');
  document.body.style.overflow = '';
}

function navigateLightbox(dir) {
  lightboxIndex = (lightboxIndex + dir + lightboxImages.length) % lightboxImages.length;
  const src = lightboxImages[lightboxIndex];

  if (lightboxShowingA) {
    lightboxImgB.src = src;
    lightboxImgB.alt = 'Artwork';
    lightboxImgB.style.opacity = '1';
    lightboxImgA.style.opacity = '0';
  } else {
    lightboxImgA.src = src;
    lightboxImgA.alt = 'Artwork';
    lightboxImgA.style.opacity = '1';
    lightboxImgB.style.opacity = '0';
  }
  lightboxShowingA = !lightboxShowingA;
}

// ---------- Fade pieces in as they enter view ----------
function observePieces() {
  const pieces = document.querySelectorAll('.piece');
  if (!pieces.length) return;

  if (!('IntersectionObserver' in window)) return;

  pieces.forEach(p => {
    p.style.opacity = 0;
    p.style.transform = 'translateY(16px)';
    p.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
  });

  const io = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = 1;
        entry.target.style.transform = 'translateY(0)';
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  pieces.forEach(p => io.observe(p));
}
