// ---------- State ----------
let CATEGORIES = [];
let lightboxImages = [];
let currentCategoryId = null;

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

  buildCardGrid();

  // Handle initial hash on page load
  handleHash();

  // Listen for back/forward navigation
  window.addEventListener('hashchange', handleHash);
});

// ---------- Hash routing ----------
function handleHash() {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) {
    closeCategory(false);
    return;
  }

  const parts = hash.split('/');
  const catId = parts[0];
  const imageIndex = parts.length > 1 ? parseInt(parts[1], 10) : null;

  const catIndex = CATEGORIES.findIndex(c => c.id === catId);
  if (catIndex === -1) return;

  openCategory(catIndex, false);

  if (imageIndex !== null && !isNaN(imageIndex) && imageIndex >= 0 && imageIndex < CATEGORIES[catIndex].images.length) {
    openLightbox(imageIndex, false);
  }
}

function pushHash(hash) {
  if (window.location.hash !== '#' + hash) {
    history.pushState(null, '', '#' + hash);
  }
}

// ---------- Category card grid ----------
function buildCardGrid() {
  const grid = document.getElementById('card-grid');
  if (!grid) return;

  const frag = document.createDocumentFragment();

  CATEGORIES.forEach((cat, i) => {
    const card = document.createElement('div');
    card.className = 'cat-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', cat.label);

    const imgWrap = document.createElement('div');
    imgWrap.className = 'cat-card-img-wrap';

    const img = document.createElement('img');
    img.className = 'cat-card-img';
    img.src = cat.featured;
    img.alt = cat.label;
    img.loading = i < 8 ? 'eager' : 'lazy';
    img.onerror = () => {
      imgWrap.style.background = 'var(--canvas-dim)';
      img.remove();
    };

    const label = document.createElement('div');
    label.className = 'cat-card-label';
    label.textContent = cat.label;

    imgWrap.appendChild(img);
    card.appendChild(imgWrap);
    card.appendChild(label);

    card.addEventListener('click', () => openCategory(i));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openCategory(i);
      }
    });

    frag.appendChild(card);
  });

  grid.appendChild(frag);
}

// ---------- Category selection ----------
function openCategory(index, updateHash = true) {
  const cardSection = document.getElementById('card-grid-section');
  const gallery = document.querySelector('.gallery-section');
  const cat = CATEGORIES[index];

  currentCategoryId = cat.id;

  // Hide card grid, show gallery
  if (cardSection) cardSection.classList.add('card-grid-section--hidden');

  buildGallery(cat);
  if (gallery) {
    gallery.classList.add('gallery--open');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (updateHash) {
    pushHash(cat.id);
  }
}

function closeCategory(updateHash = true) {
  const cardSection = document.getElementById('card-grid-section');
  const gallery = document.querySelector('.gallery-section');

  if (gallery) gallery.classList.remove('gallery--open');
  if (cardSection) cardSection.classList.remove('card-grid-section--hidden');

  currentCategoryId = null;

  if (updateHash) {
    history.pushState(null, '', window.location.pathname);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
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

function openLightbox(index, updateHash = true) {
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

  if (updateHash && currentCategoryId) {
    pushHash(currentCategoryId + '/' + lightboxIndex);
  }
}

function closeLightbox() {
  lightboxEl.classList.remove('lightbox--open');
  document.body.style.overflow = '';

  // Restore hash to just the gallery
  if (currentCategoryId) {
    pushHash(currentCategoryId);
  }
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

  // Update hash to reflect current image
  if (currentCategoryId) {
    pushHash(currentCategoryId + '/' + lightboxIndex);
  }
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
