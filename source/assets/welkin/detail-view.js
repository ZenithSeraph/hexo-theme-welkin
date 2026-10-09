/* Article inspection controls. The scene owns every camera transition. */
(() => {
  'use strict';

  let initialized = false;

  function initializeDetailView() {
    if (initialized) return;
    const home = document.getElementById('home-view');
    if (home && home.hidden) return;

    const stage = document.getElementById('feature-stage');
    const featureLink = document.getElementById('feature-link');
    if (!stage || !featureLink) return;
    initialized = true;

    const scene = document.getElementById('glass-scene');
    const selector = document.getElementById('post-selector');
    const close = document.getElementById('archive-close');
    const panel = document.getElementById('detail-panel');
    const excerpt = document.getElementById('detail-excerpt');
    const original = document.getElementById('detail-original');
    const tags = document.getElementById('detail-tags');
    const archive = document.getElementById('archive');
    const footer = document.getElementById('site-footer');
    const showArticles = document.getElementById('show-articles');
    const previous = document.getElementById('previous-archive');
    const next = document.getElementById('next-archive');
    const media = document.getElementById('feature-media');
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let previousState = 'overview';
    let pendingArchive = false;
    let backgroundPress = null;
    let layoutFrame = 0;
    let keyboardNavigation = false;

    const posts = () => Array.isArray(window.WELKIN_FEATURED) ? window.WELKIN_FEATURED : [];
    const buttons = () => selector ? Array.from(selector.querySelectorAll('button[data-post-index]')) : [];
    const sceneReady = () => scene && scene.dataset.webgl === 'ready';

    function currentState() {
      if (!sceneReady()) return 'overview';
      const state = stage.dataset.archiveView;
      return ['opening', 'open', 'closing'].includes(state) ? state : 'overview';
    }

    function currentIndex() {
      const index = Number(stage.dataset.selectedIndex);
      return Number.isInteger(index) && index >= 0 && index < posts().length ? index : 0;
    }

    function bindDetail() {
      const post = posts()[currentIndex()];
      const text = post && typeof post.excerpt === 'string' ? post.excerpt : '';
      if (excerpt) { excerpt.textContent = Array.from(text).slice(0, 480).join(''); excerpt.scrollTop = 0; }
      const articleTags = post && Array.isArray(post.tags) ? post.tags.filter(tag => typeof tag === 'string') : [];
      if (tags) {
        tags.textContent = articleTags.join(' · ');
        tags.hidden = articleTags.length === 0;
      }
      if (original) {
        const url = post && typeof post.url === 'string' ? post.url : '';
        original.hidden = !url;
        if (url) original.href = url;
        else original.removeAttribute('href');
      }
    }

    function updateDetailLayout() {
      if (!media) return;
      if (layoutFrame) cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(() => {
        layoutFrame = 0;
        const height = media.clientHeight;
        const headingHeight = featureLink.offsetHeight;
        const mobile = window.matchMedia('(max-width:700px)').matches;
        const inset = (mobile ? 20 : 26) + (stage.dataset.glassCover === 'fallback' ? height * (mobile ? .30 : .38) : 0);
        media.style.setProperty('--heading-travel', (height * .43 - headingHeight * .5 - inset) + 'px');
        const mobileOverviewTop = height - headingHeight - 90;
        media.style.setProperty('--mobile-heading-travel', (inset - mobileOverviewTop) + 'px');
        media.style.setProperty('--detail-heading-bottom', (inset + headingHeight) + 'px');
      });
    }

    function revealArticles() {
      pendingArchive = false;
      if (!archive) return;
      archive.hidden = false;
      if (footer) footer.hidden = false;
      document.body.classList.add('articles-visible');
      if (showArticles) showArticles.setAttribute('aria-expanded', 'true');
      archive.scrollIntoView({ behavior: reducedQuery.matches ? 'instant' : 'smooth', block: 'start' });
    }

    function syncView() {
      const state = currentState();
      const inspecting = state !== 'overview';
      document.body.classList.toggle('is-inspecting', inspecting);
      const linkUnavailable = state === 'opening' || state === 'open';
      if (selector) {
        selector.inert = inspecting;
        selector.setAttribute('aria-disabled', String(inspecting));
      }
      if (close) close.hidden = !inspecting;
      if (panel) panel.hidden = !inspecting;
      featureLink.tabIndex = linkUnavailable ? -1 : 0;
      featureLink.setAttribute('aria-expanded', String(inspecting));
      if (linkUnavailable) featureLink.setAttribute('aria-disabled', 'true');
      else featureLink.removeAttribute('aria-disabled');
      const navigationUnavailable = inspecting || posts().length < 2;
      if (previous) previous.disabled = navigationUnavailable;
      if (next) next.disabled = navigationUnavailable;
      if (inspecting) bindDetail();
      updateDetailLayout();

      const wasInspecting = previousState !== 'overview';
      const entering = state === 'opening' && previousState !== 'opening' && previousState !== 'open';
      // Reduced motion can finish opening synchronously, skipping an observable
      // opening frame. It still needs the same predictable close-button focus.
      const openedImmediately = state === 'open' && !wasInspecting;
      previousState = state;
      if ((entering || openedImmediately) && close && keyboardNavigation) close.focus({ preventScroll: true });
      if (!inspecting && wasInspecting && keyboardNavigation) featureLink.focus({ preventScroll: true });
      if (state === 'overview' && pendingArchive) revealArticles();
    }

    function requestClose() {
      if (currentState() === 'overview') {
        syncView();
        return;
      }
      window.dispatchEvent(new CustomEvent('welkin-close'));
      syncView();
    }

    function requestArticles() {
      if (!archive) return;
      if (currentState() === 'overview') {
        revealArticles();
        return;
      }
      pendingArchive = true;
      requestClose();
    }

    function plainClick(event) {
      return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
    }

    featureLink.addEventListener('click', event => {
      if (!plainClick(event) || !sceneReady()) return;
      const state = currentState();
      if (state === 'opening' || state === 'open') {
        event.preventDefault();
        return;
      }
      if (!posts()[currentIndex()]) return;
      pendingArchive = false;
      window.dispatchEvent(new CustomEvent('welkin-open', { detail: { index: currentIndex() } }));
      // Dispatch is synchronous. If the module has not installed a working
      // listener, leave the original link's browser behavior fully available.
      const accepted = currentState();
      if (accepted === 'opening' || accepted === 'open') {
        event.preventDefault();
        syncView();
      }
    });

    if (close) close.addEventListener('click', requestClose);
    // Only a press that began in detail mode can dismiss it. The click that
    // opens an archive therefore cannot immediately close it again.
    stage.addEventListener('pointerdown', event => {
      keyboardNavigation = false;
      if (backgroundPress && backgroundPress.id !== event.pointerId) { backgroundPress.moved = true; return; }
      backgroundPress = currentState() === 'open' || currentState() === 'opening'
        ? { id:event.pointerId, x:event.clientX, y:event.clientY, moved:false } : null;
    }, true);
    stage.addEventListener('pointermove', event => {
      if (backgroundPress && (event.pointerId !== backgroundPress.id || Math.hypot(event.clientX - backgroundPress.x, event.clientY - backgroundPress.y) > 8)) backgroundPress.moved = true;
    }, true);
    stage.addEventListener('pointercancel', () => { backgroundPress = null; }, true);
    stage.addEventListener('click', event => {
      const press = backgroundPress;
      backgroundPress = null;
      if (!press || press.moved || !plainClick(event) || event.defaultPrevented) return;
      if (currentState() !== 'open' && currentState() !== 'opening') return;
      if (!(event.target instanceof Element) || event.target.closest('#glass-scene, .feature-media, button, a, input, select, textarea')) return;
      if (window.getSelection()?.toString()) return;
      requestClose();
    });
    if (selector) {
      selector.addEventListener('click', event => {
        if (currentState() === 'overview') return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }

    function selectAdjacent(direction) {
      if (currentState() !== 'overview') return;
      const count = posts().length;
      if (count < 2) return;
      const index = (currentIndex() + direction + count) % count;
      const button = buttons().find(item => Number(item.dataset.postIndex) === index);
      if (button) button.click();
    }

    if (previous) previous.addEventListener('click', () => selectAdjacent(-1));
    if (next) next.addEventListener('click', () => selectAdjacent(1));

    document.addEventListener('keydown', event => {
      if (event.defaultPrevented) return;
      keyboardNavigation = true;
      if (event.key === 'Escape' && currentState() !== 'overview') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (currentState() !== 'overview' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
      if (!direction) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, select, textarea, a, button, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      if (window.getSelection()?.toString()) return;
      const rect = stage.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const stageVisible = rect.top < viewportHeight * 0.3 && rect.bottom > viewportHeight * 0.65;
      const pageFocus = target === document.body || target === document.documentElement;
      if (!stage.contains(target) && !(pageFocus && stageVisible)) return;
      if (posts().length < 2) return;
      event.preventDefault();
      selectAdjacent(direction);
    });

    if (showArticles) {
      showArticles.setAttribute('aria-expanded', String(Boolean(archive && !archive.hidden)));
      showArticles.addEventListener('click', requestArticles);
    }
    document.querySelectorAll('a[data-nav="archive"]').forEach(link => {
      link.addEventListener('click', event => {
        if (!plainClick(event)) return;
        event.preventDefault();
        requestArticles();
      });
    });

    const observer = new MutationObserver(syncView);
    observer.observe(stage, { attributes: true, attributeFilter: ['data-archive-view', 'data-selected-index'] });
    const coverObserver = new MutationObserver(updateDetailLayout);
    coverObserver.observe(stage, { attributes:true, attributeFilter:['data-glass-cover'] });
    if (typeof ResizeObserver === 'function' && media) {
      const layoutObserver = new ResizeObserver(updateDetailLayout);
      layoutObserver.observe(media);
      layoutObserver.observe(featureLink);
    } else window.addEventListener('resize', updateDetailLayout);
    if (scene) observer.observe(scene, { attributes: true, attributeFilter: ['data-webgl'] });
    window.addEventListener('welkin-view-change', syncView);
    window.addEventListener('welkin-ready', syncView);
    window.addEventListener('hashchange', () => {
      if (window.location.hash === '#archive') requestArticles();
    });
    syncView();
    if (window.location.hash === '#archive') requestArticles();
  }

  window.addEventListener('welkin-ready', initializeDetailView);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeDetailView, { once: true });
  else initializeDetailView();
})();
