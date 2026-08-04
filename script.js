// ---------- Gallery: built from inline data ----------
const WORKS = [
  { "image": "images/creek-wading.jpg", "title": "Untitled #1", "description": "", "size": "tall" },
  { "image": "images/painted-hills.jpg", "title": "Untitled #2", "description": "", "size": "tall" },
  { "image": "images/trailside.jpg", "title": "Untitled #3", "description": "", "size": "tall" },
  { "image": "images/bound-in-bloom.jpg", "title": "Untitled #4", "description": "", "size": "normal" },
  { "image": "images/rail-yard.jpg", "title": "Untitled #5", "description": "", "size": "wide" },
  { "image": "images/mountain-lake.jpg", "title": "Untitled #6", "description": "", "size": "normal" },
  { "image": "images/hot-spring.jpg", "title": "Untitled #7", "description": "", "size": "normal" },
  { "image": "images/studio-wall.jpg", "title": "Untitled #8", "description": "", "size": "wide" },
  { "image": "images/resting-in-grass.jpg", "title": "Untitled #9", "description": "", "size": "normal" }
];

// ---------- Hero / Gallery toggle ----------
let galleryOpen = false;

function toggleGallery(){
  const hero = document.querySelector('.hero');
  const gallery = document.querySelector('.gallery-section');
  const navBtn = document.getElementById('nav-gallery');
  const icon = navBtn ? navBtn.querySelector('.nav-gallery-icon') : null;
  if (!hero || !gallery) return;

  galleryOpen = !galleryOpen;

  if (galleryOpen){
    hero.classList.add('hero--hidden');
    gallery.classList.add('gallery--open');
    if (icon) icon.textContent = '\u2212'; // minus
  } else {
    hero.classList.remove('hero--hidden');
    gallery.classList.remove('gallery--open');
    if (icon) icon.textContent = '+';
  }
}

function initToggle(){
  const hero = document.querySelector('.hero');
  const navBtn = document.getElementById('nav-gallery');

  if (hero){
    hero.style.cursor = 'pointer';
    hero.addEventListener('click', (e) => {
      // Don't toggle if clicking a link inside hero
      if (e.target.closest('a')) return;
      if (!galleryOpen) toggleGallery();
    });
  }

  if (navBtn){
    navBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleGallery();
    });
  }
}

// ---------- Hero slideshow ----------
function initHeroSlideshow(){
  const hero = document.querySelector('.hero');
  if (!hero) return;

  const images = WORKS.map(w => w.image);

  // Create two layers for crossfade
  const bgA = hero.querySelector('.hero-bg');

  // Start after the image already shown in the HTML hero
  const heroSrc = bgA.getAttribute('src');
  let current = images.indexOf(heroSrc);
  if (current === -1) current = 0;
  const bgB = document.createElement('img');
  bgB.className = 'hero-bg hero-bg--b';
  bgB.alt = '';
  bgB.src = images[0];
  hero.insertBefore(bgB, hero.querySelector('.hero-scrim'));

  // bgA starts visible, bgB behind it
  bgA.style.opacity = '1';
  bgB.style.opacity = '0';

  let showingA = true;

  function advanceSlide(){
    current = (current + 1) % images.length;
    if (showingA){
      bgB.src = images[current];
      bgB.style.opacity = '1';
      bgA.style.opacity = '0';
    } else {
      bgA.src = images[current];
      bgA.style.opacity = '1';
      bgB.style.opacity = '0';
    }
    showingA = !showingA;
  }

  // First transition after a short delay, then regular interval
  setTimeout(() => {
    advanceSlide();
    setInterval(advanceSlide, 4000);
  }, 1500);
}

// ---------- Gallery ----------
function loadGallery(){
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;

  const frag = document.createDocumentFragment();

  WORKS.forEach((work, index) => {
    const figure = document.createElement('figure');
    figure.className = 'piece';
    if (work.size === 'tall') figure.classList.add('piece--tall');
    if (work.size === 'wide') figure.classList.add('piece--wide');

    const img = document.createElement('img');
    img.className = 'piece-img';
    img.src = work.image || '';
    img.alt = work.title ? work.title : 'Untitled artwork';
    img.loading = 'lazy';
    img.onerror = () => {
      figure.classList.add('piece--missing');
      img.remove();
    };

    const caption = document.createElement('figcaption');

    const title = document.createElement('span');
    title.className = 'p-title';
    title.textContent = work.title || 'Untitled';

    const meta = document.createElement('span');
    meta.className = 'p-meta';
    meta.textContent = work.description || '';

    caption.appendChild(title);
    if (work.description) caption.appendChild(meta);

    figure.appendChild(img);
    figure.appendChild(caption);

    // Click to open lightbox
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
let lightboxTitle = null;
let lightboxIndex = 0;
let lightboxShowingA = true;

function createLightbox(){
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
    <div class="lightbox-caption"></div>
  `;
  document.body.appendChild(lightboxEl);

  lightboxImgA = lightboxEl.querySelector('.lightbox-img--a');
  lightboxImgB = lightboxEl.querySelector('.lightbox-img--b');
  lightboxTitle = lightboxEl.querySelector('.lightbox-caption');

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

  // Touch swipe support (horizontal and vertical)
  let touchStartX = 0;
  let touchStartY = 0;
  let touchDeltaX = 0;
  let touchDeltaY = 0;
  let swipeDirection = null; // 'horizontal', 'vertical', or null

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

    // Lock in direction on first significant movement
    if (!swipeDirection && (Math.abs(dx) > 10 || Math.abs(dy) > 10)){
      swipeDirection = Math.abs(dx) >= Math.abs(dy) ? 'horizontal' : 'vertical';
    }
    if (swipeDirection){
      e.preventDefault();
      touchDeltaX = dx;
      touchDeltaY = dy;
    }
  }, { passive: false });

  lightboxEl.addEventListener('touchend', () => {
    if (swipeDirection === 'horizontal' && Math.abs(touchDeltaX) > 40){
      navigateLightbox(touchDeltaX < 0 ? 1 : -1);
    } else if (swipeDirection === 'vertical' && Math.abs(touchDeltaY) > 40){
      navigateLightbox(touchDeltaY < 0 ? 1 : -1);
    }
    swipeDirection = null;
    touchDeltaX = 0;
    touchDeltaY = 0;
  }, { passive: true });
}

function openLightbox(index){
  if (!lightboxEl) createLightbox();
  lightboxIndex = index;
  // Set both images to the same source on open (no crossfade needed)
  const work = WORKS[lightboxIndex];
  lightboxImgA.src = work.image;
  lightboxImgA.alt = work.title || 'Untitled artwork';
  lightboxImgA.style.opacity = '1';
  lightboxImgB.style.opacity = '0';
  lightboxShowingA = true;
  lightboxEl.classList.add('lightbox--open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox(){
  lightboxEl.classList.remove('lightbox--open');
  document.body.style.overflow = '';
}

function navigateLightbox(dir){
  lightboxIndex = (lightboxIndex + dir + WORKS.length) % WORKS.length;
  const work = WORKS[lightboxIndex];

  if (lightboxShowingA){
    lightboxImgB.src = work.image;
    lightboxImgB.alt = work.title || 'Untitled artwork';
    lightboxImgB.style.opacity = '1';
    lightboxImgA.style.opacity = '0';
  } else {
    lightboxImgA.src = work.image;
    lightboxImgA.alt = work.title || 'Untitled artwork';
    lightboxImgA.style.opacity = '1';
    lightboxImgB.style.opacity = '0';
  }
  lightboxShowingA = !lightboxShowingA;
}

// ---------- Fade pieces in as they enter view ----------
function observePieces(){
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
      if (entry.isIntersecting){
        entry.target.style.opacity = 1;
        entry.target.style.transform = 'translateY(0)';
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });

  pieces.forEach(p => io.observe(p));
}

document.addEventListener('DOMContentLoaded', () => {
  loadGallery();
  initHeroSlideshow();
  initToggle();
});
