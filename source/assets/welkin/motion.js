/* Small, interruptible transitions for the featured article selector. */
(() => {
  'use strict';

  let disposePrevious = null;
  const EASE_OUT = 'cubic-bezier(.22, 1, .36, 1)';
  const EASE_IMAGE = 'cubic-bezier(.16, 1, .3, 1)';

  window.initWelkinMotion = function initWelkinMotion(input) {
    if (disposePrevious) disposePrevious();

    const posts = Array.isArray(input) ? input : [];
    const stage = document.getElementById('feature-stage');
    const selector = document.getElementById('post-selector');
    if (!stage || !selector || !posts.length) return null;

    const media = document.getElementById('feature-media');
    const layers = [document.getElementById('cover-a'), document.getElementById('cover-b')].filter(Boolean);
    const link = document.getElementById('feature-link');
    const category = document.getElementById('feature-category');
    const date = document.getElementById('feature-date');
    const title = document.getElementById('feature-title');
    const position = document.getElementById('feature-position');
    const status = document.getElementById('cover-status');
    const buttons = Array.from(selector.querySelectorAll('button[data-post-index]'));
    const textElements = [category, date, title].filter(Boolean);
    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
    const mediaMotion = new Map();
    const textMotion = new Map();
    const failedCovers = new Set();
    const listeners = [];
    let reduced = reducedQuery.matches;
    let destroyed = false;
    let selected = -1;
    let sequence = 0;
    let dwell = null;
    let dwellButton = null;
    let statusDelay = null;
    let coverRequestDelay = null;
    let cancelLoad = null;
    let latestDecoded = null;
    let coverUnavailable = false;
    let coverTimedOut = false;
    let scrollFrame = null;
    let scrollTarget = null;
    let savedScrollSnap = null;
    let savedScrollBehavior = null;

    function listen(target, event, handler, options) {
      target.addEventListener(event, handler, options);
      listeners.push(() => target.removeEventListener(event, handler, options));
    }

    function opacityOf(element) {
      const value = Number.parseFloat(getComputedStyle(element).opacity);
      return Number.isFinite(value) ? value : 0;
    }

    // Read the live interpolated values before cancelling a previous transition.
    // A new selection can therefore take over without jumping to either endpoint.
    function stop(map, element, preserve = true) {
      const record = map.get(element);
      if (!record) return;
      const current = preserve ? getComputedStyle(element) : null;
      const opacity = current && current.opacity;
      const transform = current && current.transform;
      map.delete(element);
      record.animation.onfinish = null;
      record.animation.oncancel = null;
      record.animation.cancel();
      if (preserve) {
        element.style.opacity = opacity;
        element.style.transform = transform;
      }
      element.style.removeProperty('will-change');
      record.resolve(false);
    }

    function stopAll(map) {
      Array.from(map.keys()).forEach(element => stop(map, element));
    }

    function tween(map, element, from, to, duration, easing = EASE_OUT) {
      stop(map, element);
      if (reduced || typeof element.animate !== 'function') {
        Object.assign(element.style, to);
        return Promise.resolve(true);
      }
      element.style.willChange = 'opacity, transform';
      return new Promise(resolve => {
        const animation = element.animate([from, to], { duration, easing, fill: 'both' });
        const record = { animation, resolve };
        map.set(element, record);
        animation.onfinish = () => {
          if (map.get(element) !== record) return;
          Object.assign(element.style, to);
          map.delete(element);
          animation.onfinish = null;
          animation.oncancel = null;
          animation.cancel();
          element.style.removeProperty('will-change');
          resolve(true);
        };
        animation.oncancel = () => {
          if (map.get(element) === record) {
            map.delete(element);
            element.style.removeProperty('will-change');
          }
          resolve(false);
        };
      });
    }

    function frameOf(element) {
      const current = getComputedStyle(element);
      return { opacity: current.opacity, transform: current.transform };
    }

    function setCoverState(state) {
      if (statusDelay !== null) window.clearTimeout(statusDelay);
      statusDelay = null;
      if (media) {
        media.dataset.coverState = state;
        media.classList.toggle('is-loading', state === 'loading');
        media.classList.toggle('is-cover-unavailable', state === 'unavailable');
      }
      if (status) {
        status.textContent = state === 'loading' ? '载入封面…' : state === 'unavailable' ? '暂无封面' : '';
        status.hidden = state !== 'unavailable';
        if (state === 'loading') {
          // Cached covers should not flash a loading badge between transitions.
          statusDelay = window.setTimeout(() => {
            statusDelay = null;
            if (!destroyed) status.hidden = false;
          }, 180);
        }
      }
    }

    function loadCover(source) {
      if (!source || failedCovers.has(source)) return Promise.resolve(null);
      return new Promise(resolve => {
        const image = new Image();
        image.decoding = 'async';
        image.fetchPriority = 'high';
        let complete = false;
        let decoding = false;
        let timeout = null;
        const finish = result => {
          if (complete) return;
          complete = true;
          if (timeout !== null) window.clearTimeout(timeout);
          image.onload = null;
          image.onerror = null;
          if (cancelLoad === cancel) cancelLoad = null;
          resolve(result);
        };
        const cancel = () => finish(null);
        cancelLoad = cancel;
        const loaded = async () => {
          if (complete || decoding) return;
          decoding = true;
          try {
            if (typeof image.decode === 'function') await image.decode();
          } catch (_) {
            // Some browsers reject decode for an otherwise usable loaded image.
          }
          if (complete) return;
          if (image.naturalWidth > 0) finish(source);
          else {
            failedCovers.add(source);
            finish(null);
          }
        };
        image.onload = loaded;
        image.onerror = () => {
          failedCovers.add(source);
          finish(null);
        };
        // Only inspect `complete` after assigning src. Empty images are also
        // complete, but cannot be used as a visible first cover.
        timeout = window.setTimeout(() => {
          // Timeouts are transient: selecting this article again can retry.
          coverTimedOut = true;
          finish(null);
        }, 15000);
        image.src = source;
        if (image.complete && image.naturalWidth > 0) void loaded();
      });
    }

    function assignCover(layer, source, post) {
      if (layer.getAttribute('src') !== source) layer.src = source;
      layer.alt = post.title ? `${post.title} · 文章封面` : '文章封面';
    }

    function displayInstant(source, post) {
      stopAll(mediaMotion);
      layers.forEach((layer, index) => {
        if (index === 0) assignCover(layer, source, post);
        layer.style.opacity = index === 0 ? '1' : '0';
        layer.style.transform = 'none';
      });
      if (media) media.classList.add('has-cover');
      setCoverState('ready');
    }

    async function presentCover(source, post, request) {
      if (!layers.length || destroyed || request !== sequence) return;
      if (reduced || layers.length === 1) {
        displayInstant(source, post);
        return;
      }

      stopAll(mediaMotion);
      let incoming = layers.find(layer => layer.getAttribute('src') === source);
      if (!incoming) {
        incoming = opacityOf(layers[0]) <= opacityOf(layers[1]) ? layers[0] : layers[1];
        const survivor = layers.find(layer => layer !== incoming);
        if (opacityOf(incoming) > 0.012) {
          // Two buffers may both still be visible after a fast change. Clear the
          // quieter one before replacing its pixels; never swap a visible src.
          await Promise.all([
            tween(mediaMotion, incoming, frameOf(incoming), { opacity: '0', transform: 'translateY(-3px) scale(1.008)' }, 130),
            tween(mediaMotion, survivor, frameOf(survivor), { opacity: '1', transform: 'none' }, 130),
          ]);
          if (destroyed || request !== sequence) return;
          if (reduced) {
            displayInstant(source, post);
            return;
          }
        }
        assignCover(incoming, source, post);
        incoming.style.opacity = '0';
        incoming.style.transform = 'translateY(9px) scale(1.022)';
      } else {
        assignCover(incoming, source, post);
      }

      const outgoing = layers.find(layer => layer !== incoming);
      if (media) media.classList.add('has-cover');
      setCoverState('ready');
      void tween(mediaMotion, incoming, frameOf(incoming), { opacity: '1', transform: 'none' }, 620, EASE_IMAGE);
      void tween(mediaMotion, outgoing, frameOf(outgoing), { opacity: '0', transform: 'translateY(-5px) scale(1.008)' }, 560, EASE_IMAGE);
    }

    function presentFallback() {
      stopAll(mediaMotion);
      setCoverState('unavailable');
      if (status && coverTimedOut) status.textContent = '封面载入超时 · 再次选文重试';
      if (media) media.classList.remove('has-cover');
      layers.forEach(layer => {
        void tween(mediaMotion, layer, frameOf(layer), { opacity: '0', transform: 'none' }, 320);
      });
    }

    function changeText(post, initial) {
      const starts = new Map(textElements.map(element => [element, {
        running: textMotion.has(element),
        frame: frameOf(element),
      }]));
      stopAll(textMotion);
      if (link) link.href = String(post.url || '#');
      if (category) category.textContent = String(post.category || '随笔');
      if (date) {
        const parts = String(post.date || '').match(/^(\d{4})[-./](\d{2})[-./](\d{2})/)
          || String(post.publishedAt || '').match(/^(\d{4})[-./](\d{2})[-./](\d{2})/);
        date.textContent = parts ? parts.slice(1).join('.') : '';
        if (parts) date.dateTime = parts.slice(1).join('-');
        else date.removeAttribute('datetime');
      }
      if (title) title.textContent = String(post.title || '未命名文章');
      // The closing scene already fades the whole heading. Restoring its home
      // text underneath that fade must not start a second, competing entrance.
      if (initial || reduced || stage.dataset.archiveView === 'closing' || stage.dataset.selectionRestore === 'true') {
        textElements.forEach(element => {
          element.style.opacity = '1';
          element.style.transform = 'none';
        });
        return;
      }
      textElements.forEach((element, index) => {
        const previous = starts.get(element);
        const from = previous.running ? previous.frame : { opacity: '.76', transform: 'translateY(5px)' };
        void tween(textMotion, element, from, { opacity: '1', transform: 'none' }, 360 + index * 35);
      });
    }

    function clearDwell() {
      if (dwell !== null) window.clearTimeout(dwell);
      dwell = null;
      dwellButton = null;
    }

    function stopSelectorScroll() {
      if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
      scrollFrame = null;
      scrollTarget = null;
      if (savedScrollSnap !== null) selector.style.scrollSnapType = savedScrollSnap;
      if (savedScrollBehavior !== null) selector.style.scrollBehavior = savedScrollBehavior;
      savedScrollSnap = null;
      savedScrollBehavior = null;
    }

    function keepSelectionVisible(button) {
      stopSelectorScroll();
      if (!button) return;
      const container = selector.getBoundingClientRect();
      const card = button.getBoundingClientRect();
      const left = container.left + selector.clientLeft;
      const right = left + selector.clientWidth;
      const start = selector.scrollLeft;
      // Move only as far as necessary; the page's vertical position is untouched.
      const delta = card.left < left ? card.left - left : card.right > right ? card.right - right : 0;
      const target = Math.max(0, Math.min(selector.scrollWidth - selector.clientWidth, start + delta));
      if (Math.abs(target - start) < 1) return;
      if (reduced) {
        selector.scrollTo({ left: target, behavior: 'instant' });
        return;
      }
      savedScrollSnap = selector.style.scrollSnapType;
      savedScrollBehavior = selector.style.scrollBehavior;
      selector.style.scrollSnapType = 'none';
      selector.style.scrollBehavior = 'auto';
      scrollTarget = target;
      const began = performance.now();
      const duration = Math.min(360, Math.max(240, Math.abs(target - start) * 0.55));
      const frame = now => {
        if (destroyed) {
          stopSelectorScroll();
          return;
        }
        const progress = Math.min(1, (now - began) / duration);
        const eased = 1 - Math.pow(1 - progress, 4);
        selector.scrollTo({ left: start + (target - start) * eased, behavior: 'instant' });
        if (progress < 1) scrollFrame = window.requestAnimationFrame(frame);
        else stopSelectorScroll();
      };
      scrollFrame = window.requestAnimationFrame(frame);
    }

    function select(index) {
      clearDwell();
      if (destroyed || !Number.isInteger(index) || index < 0 || index >= posts.length || !posts[index] || (index === selected && !coverUnavailable)) return;
      const initial = selected === -1;
      const post = posts[index];
      const request = ++sequence;
      selected = index;
      latestDecoded = null;
      coverUnavailable = false;
      coverTimedOut = false;
      if (coverRequestDelay !== null) window.clearTimeout(coverRequestDelay);
      coverRequestDelay = null;
      if (cancelLoad) cancelLoad();
      stage.dataset.selectedIndex = String(index);
      buttons.forEach(button => {
        const chosen = Number(button.dataset.postIndex) === index;
        button.setAttribute('aria-pressed', String(chosen));
        button.classList.toggle('is-selected', chosen);
      });
      keepSelectionVisible(buttons.find(button => Number(button.dataset.postIndex) === index));
      if (position) position.textContent = `${String(index + 1).padStart(2, '0')} / ${String(posts.length).padStart(2, '0')}`;
      changeText(post, initial);
      if (!layers.length) return;
      // Keep the previous cover calm while a wheel/swipe moves through articles.
      // Only the article left selected after the dwell needs an image request.
      setCoverState('pending');
      const originalCover = typeof post.cover === 'string' ? post.cover.trim() : '';
      const displayCover = typeof post.displayCover === 'string' ? post.displayCover.trim() : '';
      const preferredCover = displayCover || originalCover;
      const loadSelectedCover = async () => {
        if (destroyed || request !== sequence) return;
        setCoverState('loading');
        let source = await loadCover(preferredCover);
        if (destroyed || request !== sequence) return;
        if (!source && originalCover && preferredCover !== originalCover) {
          // A processed CDN rendition may fail independently of its original.
          // Try that original once, while keeping old selections out of the UI.
          coverTimedOut = false;
          source = await loadCover(originalCover);
          if (destroyed || request !== sequence) return;
        }
        if (!source) {
          coverUnavailable = true;
          presentFallback();
          return;
        }
        latestDecoded = { source, post, request };
        void presentCover(source, post, request);
      };
      if (initial) void loadSelectedCover();
      else {
        coverRequestDelay = window.setTimeout(() => {
          coverRequestDelay = null;
          void loadSelectedCover();
        }, 200);
      }
    }

    function schedule(button) {
      clearDwell();
      dwellButton = button;
      dwell = window.setTimeout(() => select(Number(button.dataset.postIndex)), 200);
    }

    buttons.forEach(button => {
      button.type = 'button';
      listen(button, 'pointerenter', event => {
        if (hoverQuery.matches && event.pointerType !== 'touch') schedule(button);
      });
      listen(button, 'pointerleave', () => {
        if (dwellButton === button) clearDwell();
      });
      listen(button, 'focus', () => schedule(button));
      listen(button, 'blur', () => {
        if (dwellButton === button) clearDwell();
      });
      listen(button, 'click', () => select(Number(button.dataset.postIndex)));
      listen(button, 'keydown', event => {
        const current = buttons.indexOf(button);
        let next = null;
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (current + 1) % buttons.length;
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = buttons.length - 1;
        if (next === null) return;
        event.preventDefault();
        buttons[next].focus({ preventScroll: true });
      });
    });

    function onMotionPreference(event) {
      reduced = event.matches;
      stage.dataset.motion = reduced ? 'reduced' : 'full';
      if (!reduced) return;
      const pendingScroll = scrollTarget;
      stopSelectorScroll();
      if (pendingScroll !== null) selector.scrollTo({ left: pendingScroll, behavior: 'instant' });
      stopAll(mediaMotion);
      stopAll(textMotion);
      textElements.forEach(element => {
        element.style.opacity = '1';
        element.style.transform = 'none';
      });
      if (latestDecoded && latestDecoded.request === sequence) {
        displayInstant(latestDecoded.source, latestDecoded.post);
      } else if (coverUnavailable) {
        layers.forEach(layer => {
          layer.style.opacity = '0';
          layer.style.transform = 'none';
        });
      } else {
        const visible = layers.slice().sort((a, b) => opacityOf(b) - opacityOf(a))[0];
        const hasVisible = visible && opacityOf(visible) > 0;
        layers.forEach(layer => {
          layer.style.opacity = hasVisible && layer === visible ? '1' : '0';
          layer.style.transform = 'none';
        });
      }
    }

    listen(reducedQuery, 'change', onMotionPreference);
    listen(hoverQuery, 'change', clearDwell);
    listen(window, 'resize', stopSelectorScroll, { passive: true });
    const interruptSelectorScroll = () => {
      stopSelectorScroll();
      clearDwell();
    };
    listen(selector, 'pointerdown', interruptSelectorScroll, { passive: true });
    listen(selector, 'touchstart', interruptSelectorScroll, { passive: true });
    listen(selector, 'wheel', interruptSelectorScroll, { passive: true });
    listen(selector, 'keydown', stopSelectorScroll);
    listen(document, 'visibilitychange', () => {
      if (document.hidden) clearDwell();
    });
    stage.dataset.motion = reduced ? 'reduced' : 'full';
    layers.forEach(layer => {
      layer.style.opacity = '0';
      layer.style.transform = 'none';
      layer.setAttribute('aria-hidden', 'true');
    });

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      ++sequence;
      clearDwell();
      stopSelectorScroll();
      if (statusDelay !== null) window.clearTimeout(statusDelay);
      if (coverRequestDelay !== null) window.clearTimeout(coverRequestDelay);
      if (cancelLoad) cancelLoad();
      stopAll(mediaMotion);
      stopAll(textMotion);
      listeners.forEach(remove => remove());
      if (disposePrevious === destroy) disposePrevious = null;
    }

    disposePrevious = destroy;
    select(0);
    return { select, destroy };
  };
})();
