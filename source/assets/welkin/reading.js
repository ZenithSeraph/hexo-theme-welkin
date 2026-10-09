/* Reading remains complete without JavaScript; only bounded decoration moves. */
(() => {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const themeButton = document.getElementById('reading-theme');
  let storedTheme = '';
  try { storedTheme = localStorage.getItem('welkin-reading-theme') || ''; } catch (_) { /* Private browsing can disable storage. */ }

  function applyTheme(dark) {
    document.body.classList.toggle('reading-dark', dark);
    if (themeButton) {
      themeButton.setAttribute('aria-pressed', String(dark));
      themeButton.textContent = dark ? '浅色阅读' : '深色阅读';
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#22241f' : '#eae5e1');
  }
  applyTheme(storedTheme === 'dark');
  if (themeButton) {
    themeButton.hidden = false;
    themeButton.addEventListener('click', () => {
      const dark = !document.body.classList.contains('reading-dark');
      applyTheme(dark);
      try { localStorage.setItem('welkin-reading-theme', dark ? 'dark' : 'light'); } catch (_) { /* The current page still changes theme. */ }
    });
  }

  // The aligned glass frame stays static, even on very long articles. Only the
  // small header receives an entrance; no full-page GPU layer is allocated.
  if (!reduced.matches && !location.hash && typeof Element.prototype.animate === 'function') {
    const header = document.querySelector('.reading-header');
    const animations = [];
    if (header) animations.push(header.animate([
      { opacity: .8, transform: 'translateY(10px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 620, easing: 'cubic-bezier(.16,1,.3,1)' }));
    reduced.addEventListener('change', event => { if (event.matches) animations.forEach(animation => animation.finish()); }, { once: true });
  }

  // A keyboard reader can inspect an overflowing code sample or table without
  // turning every ordinary content block into a tab stop.
  document.querySelectorAll('.prose pre,.prose table').forEach(element => {
    if (element.scrollWidth > element.clientWidth) element.tabIndex = 0;
  });

  // A native modal gives image inspection its own focus scope without loading a
  // gallery library, preloading neighbouring files, or touching the source HTML.
  if (typeof HTMLDialogElement === 'undefined' || typeof HTMLDialogElement.prototype.showModal !== 'function') return;
  const zoomable = new WeakSet();
  document.querySelectorAll('.prose img').forEach(image => {
    // Existing image links and controls retain their original browser behaviour.
    if (image.closest('a,button,[role="button"],[contenteditable="true"]')) return;
    zoomable.add(image);
    image.classList.add('is-zoomable');
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-haspopup', 'dialog');
    image.setAttribute('aria-label', '查看大图' + (image.alt ? '：' + image.alt : ''));
  });

  let viewer = null;
  let viewerImage = null;
  let viewerStatus = null;
  let triggerImage = null;

  function createViewer() {
    viewer = document.createElement('dialog');
    viewer.className = 'image-viewer';
    viewer.setAttribute('aria-label', '图片预览');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'image-viewer-close';
    close.textContent = '关闭 ×';
    close.setAttribute('aria-label', '关闭图片预览');
    close.autofocus = true;
    const stage = document.createElement('div');
    stage.className = 'image-viewer-stage';
    viewerImage = document.createElement('img');
    viewerImage.className = 'image-viewer-image';
    viewerImage.decoding = 'async';
    viewerStatus = document.createElement('p');
    viewerStatus.className = 'image-viewer-status';
    viewerStatus.setAttribute('role', 'status');
    stage.append(viewerImage, viewerStatus);
    viewer.append(close, stage);
    document.body.append(viewer);

    close.addEventListener('click', () => viewer.close());
    viewer.addEventListener('click', event => {
      if (event.target === viewer || event.target === stage) viewer.close();
    });
    // Escape uses the dialog's native cancel behaviour. Its close event also
    // releases the large image and restores focus after every closing method.
    viewer.addEventListener('close', () => {
      document.documentElement.classList.remove('image-viewer-open');
      viewerImage.removeAttribute('src');
      viewerImage.alt = '';
      viewerStatus.textContent = '';
      if (triggerImage?.isConnected) triggerImage.focus({ preventScroll: true });
      triggerImage = null;
    });
    viewerImage.addEventListener('load', () => {
      if (viewer.open) viewerStatus.textContent = '';
    });
    viewerImage.addEventListener('error', () => {
      if (viewer.open && viewerImage.hasAttribute('src')) viewerStatus.textContent = '图片暂时无法载入，请关闭后重试。';
    });
  }

  function inspectImage(image) {
    const source = image.currentSrc || image.src;
    if (!source) return;
    if (!viewer) createViewer();
    triggerImage = image;
    viewerImage.alt = image.alt || '文章图片';
    viewerStatus.textContent = '正在载入图片…';
    viewer.showModal();
    document.documentElement.classList.add('image-viewer-open');
    // Only this selected image receives a request; the article's lazy loading
    // and its original src values remain unchanged.
    viewerImage.src = source;
  }

  document.querySelectorAll('.prose').forEach(prose => {
    prose.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (zoomable.has(event.target)) inspectImage(event.target);
    });
    prose.addEventListener('keydown', event => {
      if (event.defaultPrevented || !['Enter', ' '].includes(event.key) || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (!zoomable.has(event.target)) return;
      event.preventDefault();
      inspectImage(event.target);
    });
  });
})();
