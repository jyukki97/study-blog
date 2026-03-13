// 단일 포스트 페이지 UX 보강
// - TOC active sync
// - 읽기 진행률 바
// - 집중 모드 토글

document.addEventListener('DOMContentLoaded', function () {
  const tocSidebar = document.querySelector('.toc-sidebar');
  const tocLinks = document.querySelectorAll('.toc a');
  const headings = document.querySelectorAll(
    '.post-content h1[id], .post-content h2[id], .post-content h3[id], .post-content h4[id], .post-content h5[id], .post-content h6[id]'
  );

  const progressBar = document.getElementById('reading-progress-bar');
  const focusButton = document.getElementById('focus-mode-toggle');

  // --- 집중 모드 ---
  const focusStorageKey = 'study-blog-focus-mode';

  function applyFocusMode(enabled) {
    document.body.classList.toggle('focus-mode', enabled);
    if (focusButton) {
      focusButton.setAttribute('aria-pressed', String(enabled));
      focusButton.textContent = enabled ? '집중 모드 ON' : '집중 모드';
    }
  }

  if (focusButton) {
    const saved = localStorage.getItem(focusStorageKey) === 'on';
    applyFocusMode(saved);

    focusButton.addEventListener('click', function () {
      const next = !document.body.classList.contains('focus-mode');
      applyFocusMode(next);
      localStorage.setItem(focusStorageKey, next ? 'on' : 'off');
    });
  }

  // --- 읽기 진행률 ---
  function updateReadingProgress() {
    if (!progressBar) return;

    const doc = document.documentElement;
    const scrollTop = window.scrollY || doc.scrollTop || 0;
    const scrollable = doc.scrollHeight - window.innerHeight;

    if (scrollable <= 0) {
      progressBar.style.width = '0%';
      return;
    }

    const percent = Math.min(100, Math.max(0, (scrollTop / scrollable) * 100));
    progressBar.style.width = `${percent}%`;
  }

  // --- TOC active sync ---
  let isScrollingToSection = false;

  if (tocLinks.length > 0) {
    tocLinks.forEach(link => {
      link.addEventListener('click', function (e) {
        e.preventDefault();
        isScrollingToSection = true;

        const href = this.getAttribute('href');
        if (!href || href.length <= 1) {
          isScrollingToSection = false;
          return;
        }

        const targetId = decodeURIComponent(href.substring(1));
        const targetElement = document.getElementById(targetId);

        if (targetElement) {
          window.scrollTo({
            top: targetElement.offsetTop - 100,
            behavior: 'smooth'
          });
        }

        setTimeout(() => {
          isScrollingToSection = false;
        }, 900);
      });
    });
  }

  function updateTOC() {
    if (!tocSidebar || tocLinks.length === 0 || headings.length === 0) return;
    if (isScrollingToSection) return;

    const scrollPosition = window.scrollY + 150;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const isNearBottom = (window.scrollY + windowHeight) >= (documentHeight - 100);

    let currentHeading = null;

    if (isNearBottom) {
      currentHeading = headings[headings.length - 1];
    } else {
      for (let i = headings.length - 1; i >= 0; i--) {
        if (headings[i].offsetTop <= scrollPosition) {
          currentHeading = headings[i];
          break;
        }
      }
    }

    tocLinks.forEach(link => link.classList.remove('active'));
    if (!currentHeading) return;

    const currentId = currentHeading.getAttribute('id');
    let activeLink = null;

    for (const link of tocLinks) {
      const href = link.getAttribute('href');
      if (!href) continue;

      const linkId = href.substring(1);
      const decodedLinkId = decodeURIComponent(linkId);

      if (decodedLinkId === currentId || linkId === currentId) {
        activeLink = link;
        break;
      }
    }

    if (!activeLink) return;

    activeLink.classList.add('active');

    let linkOffsetTop = 0;
    let element = activeLink;
    while (element && element !== tocSidebar) {
      linkOffsetTop += element.offsetTop;
      element = element.offsetParent;
    }

    let centerPosition = linkOffsetTop - (tocSidebar.clientHeight / 2) + (activeLink.offsetHeight / 2);
    const maxScroll = tocSidebar.scrollHeight - tocSidebar.clientHeight;
    centerPosition = Math.max(0, Math.min(centerPosition, maxScroll));

    if (Math.abs(tocSidebar.scrollTop - centerPosition) > 20) {
      tocSidebar.scrollTo({ top: centerPosition, behavior: 'smooth' });
    }
  }

  let ticking = false;
  function onScrollFrame() {
    updateReadingProgress();
    updateTOC();
    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      window.requestAnimationFrame(onScrollFrame);
      ticking = true;
    }
  }, { passive: true });

  updateReadingProgress();
  updateTOC();
});
