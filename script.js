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

// Zoom state
let zoomScale = 1;
let zoomX = 0;
let zoomY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartZoomX = 0;
let panStartZoomY = 0;

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
    if (e.key === 'Escape') {
      if (zoomScale > 1) { resetZoom(); } else { closeLightbox(); }
    }
    if (e.key === 'ArrowLeft') navigateLightbox(-1);
    if (e.key === 'ArrowRight') navigateLightbox(1);
  });

  // Click on stage to toggle zoom
  const stage = lightboxEl.querySelector('.lightbox-stage');
  stage.addEventListener('click', (e) => {
    if (e.target.closest('.lightbox-prev, .lightbox-next, .lightbox-close')) return;
    if (isPanning) return;
    if (zoomScale > 1) {
      resetZoom();
    } else {
      zoomToPoint(2.5, e.clientX, e.clientY);
    }
  });

  // Scroll wheel zoom
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.85 : 1.18;
    const newScale = Math.min(5, Math.max(1, zoomScale * delta));
    if (newScale === 1) {
      resetZoom();
    } else {
      zoomToPoint(newScale, e.clientX, e.clientY);
    }
  }, { passive: false });

  // Mouse drag to pan when zoomed
  let didDrag = false;
  stage.addEventListener('mousedown', (e) => {
    if (zoomScale <= 1 || e.button !== 0) return;
    e.preventDefault();
    isPanning = true;
    didDrag = false;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartZoomX = zoomX;
    panStartZoomY = zoomY;
    lightboxEl.classList.add('lightbox--panning');
  });
  document.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    didDrag = true;
    zoomX = panStartZoomX + (e.clientX - panStartX);
    zoomY = panStartZoomY + (e.clientY - panStartY);
    applyZoomTransform();
  });
  document.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      lightboxEl.classList.remove('lightbox--panning');
      // Suppress the click that follows mouseup after a drag
      if (didDrag) {
        stage.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); }, { capture: true, once: true });
      }
    }
  });

  // Touch: swipe to navigate + pinch to zoom + drag to pan
  let touchStartX = 0;
  let touchStartY = 0;
  let touchDeltaX = 0;
  let touchDeltaY = 0;
  let swipeDirection = null;
  let pinchStartDist = 0;
  let pinchStartScale = 1;
  let touchPanStartX = 0;
  let touchPanStartY = 0;
  let touchPanZoomX = 0;
  let touchPanZoomY = 0;
  let touchMoved = false;

  lightboxEl.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      // Pinch start
      pinchStartDist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      pinchStartScale = zoomScale;
      swipeDirection = 'pinch';
    } else if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchDeltaX = 0;
      touchDeltaY = 0;
      touchMoved = false;
      swipeDirection = null;
      if (zoomScale > 1) {
        swipeDirection = 'pan';
        touchPanStartX = e.touches[0].clientX;
        touchPanStartY = e.touches[0].clientY;
        touchPanZoomX = zoomX;
        touchPanZoomY = zoomY;
      }
    }
  }, { passive: true });

  lightboxEl.addEventListener('touchmove', (e) => {
    if (swipeDirection === 'pinch' && e.touches.length === 2) {
      e.preventDefault();
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const newScale = Math.min(5, Math.max(1, pinchStartScale * (dist / pinchStartDist)));
      if (newScale === 1) {
        resetZoom();
      } else {
        zoomToPoint(newScale, midX, midY);
      }
      return;
    }
    if (e.touches.length !== 1) return;

    if (swipeDirection === 'pan') {
      e.preventDefault();
      zoomX = touchPanZoomX + (e.touches[0].clientX - touchPanStartX);
      zoomY = touchPanZoomY + (e.touches[0].clientY - touchPanStartY);
      applyZoomTransform();
      touchMoved = true;
      return;
    }

    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;

    if (!swipeDirection && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      swipeDirection = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
    }
    if (swipeDirection === 'horizontal' || swipeDirection === 'vertical') {
      e.preventDefault();
      touchDeltaX = dx;
      touchDeltaY = dy;
      touchMoved = true;
    }
  }, { passive: false });

  lightboxEl.addEventListener('touchend', (e) => {
    if (swipeDirection === 'pinch') {
      swipeDirection = null;
      return;
    }
    if (swipeDirection === 'pan') {
      // Double-tap to zoom out when zoomed
      swipeDirection = null;
      return;
    }
    if (swipeDirection === 'horizontal' && Math.abs(touchDeltaX) > 40) {
      navigateLightbox(touchDeltaX < 0 ? 1 : -1);
    } else if (swipeDirection === 'vertical' && Math.abs(touchDeltaY) > 40) {
      navigateLightbox(touchDeltaY < 0 ? 1 : -1);
    } else if (!touchMoved && e.changedTouches.length === 1) {
      // Tap to zoom in, tap again to zoom out
      if (zoomScale > 1) {
        resetZoom();
      } else {
        zoomToPoint(2.5, e.changedTouches[0].clientX, e.changedTouches[0].clientY);
      }
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
  resetZoom();
  lightboxEl.classList.remove('lightbox--open');
  document.body.style.overflow = '';

  // Restore hash to just the gallery
  if (currentCategoryId) {
    pushHash(currentCategoryId);
  }
}

function navigateLightbox(dir) {
  if (zoomScale > 1) { resetZoom(); return; }
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

// ---------- Zoom helpers ----------
function activeImg() {
  return lightboxShowingA ? lightboxImgA : lightboxImgB;
}

function applyZoomTransform() {
  const img = activeImg();
  if (!img) return;
  img.style.transform = `translate(${zoomX}px, ${zoomY}px) scale(${zoomScale})`;
  img.style.transition = 'opacity 0.8s ease';
}

function zoomToPoint(newScale, cx, cy) {
  const img = activeImg();
  if (!img) return;
  const rect = img.getBoundingClientRect();
  const imgCx = rect.left + rect.width / 2;
  const imgCy = rect.top + rect.height / 2;

  // Keep the point under the cursor stationary
  const ratio = newScale / zoomScale;
  const offX = cx - imgCx;
  const offY = cy - imgCy;
  zoomX = zoomX * ratio - offX * (ratio - 1);
  zoomY = zoomY * ratio - offY * (ratio - 1);

  zoomScale = newScale;
  applyZoomTransform();
  lightboxEl.classList.toggle('lightbox--zoomed', zoomScale > 1);
}

function resetZoom() {
  zoomScale = 1;
  zoomX = 0;
  zoomY = 0;
  const img = activeImg();
  if (img) {
    img.style.transform = '';
    img.style.transition = 'opacity 0.8s ease, transform 0.3s ease';
    // Reset transition after animation
    setTimeout(() => { if (img) img.style.transition = 'opacity 0.8s ease'; }, 300);
  }
  if (lightboxEl) {
    lightboxEl.classList.remove('lightbox--zoomed');
    lightboxEl.classList.remove('lightbox--panning');
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
