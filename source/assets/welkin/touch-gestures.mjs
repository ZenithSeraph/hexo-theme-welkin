/* Touch Events own touch input; Pointer Events remain available to mouse/pen.
 * Touch action is set before a gesture starts, and native multi-touch is never
 * cancelled. See https://www.w3.org/TR/touch-events/ for compatibility clicks.
 */
import { axisValue, classifyArchiveTarget, dominantAxis, fingerDirection } from './archive-input.mjs';

export function createArchiveTouchGestures(options) {
  const surface = options.surface;
  const doc = surface.ownerDocument;
  const win = doc.defaultView;
  const now = options.now || (() => win.performance.now());
  const setTimer = options.setTimer || win.setTimeout.bind(win);
  const clearTimer = options.clearTimer || win.clearTimeout.bind(win);
  const threshold = options.threshold ?? 36;
  const tapSlop = options.tapSlop ?? 8;
  const holdDelay = options.holdDelay ?? 300;
  const stepInterval = options.stepInterval ?? 140;
  const surfaces = [...new Set([surface, ...(options.touchSurfaces || [])])];
  const ownsTouchPointers = options.supportsTouchEvents ?? ('ontouchstart' in win || typeof win.TouchEvent === 'function');
  const panAction = win.CSS?.supports && !win.CSS.supports('touch-action', 'pinch-zoom') ? 'auto' : 'pinch-zoom';
  const originalStyles = surfaces.map(element => ({ element, action: element.style.touchAction }));
  const originalSelection = { user: surface.style.userSelect, webkit: surface.style.webkitUserSelect, callout: surface.style.webkitTouchCallout };
  let active = null;
  let blocked = false;
  let touchCount = 0;
  let holdTimer = 0;
  let suppression = null;
  let disposed = false;
  let listening = false;

  function mode() { return options.getMode(); }
  function context(value) { return value === 'opening' || value === 'open' ? 'detail' : value; }
  function panAllowed() { return ownsTouchPointers && options.canPan(); }
  function list(touches) { return Array.from(touches || []); }
  function point(touch) { return { id: touch.identifier, clientX: touch.clientX, clientY: touch.clientY }; }
  function find(touches, id) { return list(touches).find(touch => touch.identifier === id); }
  function publish(value) { surface.dataset.touchGesture = value; }

  function classify(target) {
    return classifyArchiveTarget(target, surface);
  }

  function clearHold() {
    if (holdTimer) clearTimer(holdTimer);
    holdTimer = 0;
  }

  function unlistenGesture() {
    if (!listening) return;
    doc.removeEventListener('touchend', end, true);
    doc.removeEventListener('touchcancel', touchCancel, true);
    listening = false;
  }

  function listenGesture() {
    if (listening) return;
    // End/cancel can arrive after the contact moves beyond the stage. Tracking
    // them here is independent of Safari's PointerEvent capture lifecycle.
    doc.addEventListener('touchend', end, { capture: true, passive: false });
    doc.addEventListener('touchcancel', touchCancel, { capture: true, passive: true });
    listening = true;
  }

  function suppressClick(gesture) {
    suppression = { target: gesture.target, start: gesture.start, end: gesture.last, expires: now() + 800 };
  }

  function endPreview(gesture) {
    clearHold();
    if (!gesture.previewEnded) {
      gesture.previewEnded = true;
      options.onPreviewEnd?.(gesture);
    }
  }

  function cancel(reason = 'cancelled', keepBlocked = false) {
    const gesture = active;
    active = null;
    blocked = keepBlocked;
    clearHold();
    unlistenGesture();
    if (gesture) {
      endPreview(gesture);
      suppressClick(gesture);
      options.onRelease?.({ ...gesture, reason, cancelled: true });
    }
    publish(keepBlocked ? 'multitouch' : 'idle');
  }

  function valid(gesture) {
    return !disposed && context(mode()) === gesture.context && panAllowed() === gesture.pan;
  }

  function refresh() {
    if (disposed) return;
    const pan = panAllowed();
    for (const element of surfaces) element.style.touchAction = pan ? panAction : 'auto';
    surface.style.userSelect = pan ? 'none' : originalSelection.user;
    surface.style.webkitUserSelect = pan ? 'none' : originalSelection.webkit;
    surface.style.webkitTouchCallout = pan ? 'none' : originalSelection.callout;
    surface.dataset.touchNavigation = pan ? 'true' : 'false';
    if (active && !valid(active)) cancel('mode-change', true);
  }

  function anyStart(event) {
    // A new physical touch is never swallowed by an old compatibility-click
    // guard, even if it immediately targets a footer button at the same point.
    suppression = null;
    const touches = list(event.touches);
    touchCount = touches.length;
    if (touches.length > 1) {
      cancel('multitouch', true);
      return;
    }
    if (touches.length === 1 && active && touches[0].identifier !== active.id) cancel('replaced-touch');
    if (touches.length === 1 && !active) blocked = false;
  }

  function start(event) {
    if (disposed || blocked || active || !ownsTouchPointers) return;
    const touches = list(event.touches);
    if (touches.length !== 1) return;
    const initialMode = mode();
    if (initialMode === 'inactive') return;
    const hit = classify(touches[0].target || event.target);
    if (!hit) return;
    const initial = point(touches[0]);
    active = {
      ...hit, id: initial.id, mode: initialMode, context: context(initialMode), pan: panAllowed(),
      start: initial, last: initial, startTime: now(), lastStep: -Infinity,
      axis: null, axisCoordinate: 0, axisDirection: 0, pendingDistance: 0,
      phase: 'press', moved: false, stepped: false, held: false, previewEnded: false,
    };
    active.payload = options.onPress?.(active);
    listenGesture();
    publish(active.pan ? 'press' : 'native');
    // Do not cancel touchstart: two fingers may begin a native pinch. The first
    // eligible, cancelable single-finger move is cancelled before any threshold.
    if (active.pan) {
      const gesture = active;
      holdTimer = setTimer(() => {
        holdTimer = 0;
        if (active !== gesture || !valid(gesture) || gesture.moved || gesture.stepped) return;
        gesture.held = true;
        gesture.phase = 'holding';
        publish('holding');
        options.onHold?.(gesture);
      }, holdDelay);
    }
  }

  function advance(gesture, current, ending = false) {
    gesture.last = current;
    const totalX = current.clientX - gesture.start.clientX;
    const totalY = current.clientY - gesture.start.clientY;
    if (Math.hypot(totalX, totalY) > tapSlop) {
      gesture.moved = true;
      endPreview(gesture);
    }
    if (!gesture.pan || gesture.held) return;
    let distance;
    if (!gesture.axis) {
      if (Math.hypot(totalX, totalY) < threshold) return;
      gesture.axis = dominantAxis(totalX, totalY);
      distance = axisValue(gesture.axis, totalX, totalY);
      gesture.axisCoordinate = axisValue(gesture.axis, current.clientX, current.clientY);
    } else {
      const coordinate = axisValue(gesture.axis, current.clientX, current.clientY);
      distance = coordinate - gesture.axisCoordinate;
      gesture.axisCoordinate = coordinate;
    }
    // Once chosen, the principal axis remains fixed until release. Detect a
    // true reversal from adjacent samples, not from the last emitted step.
    if (Math.abs(distance) > 0.01) {
      const direction = Math.sign(distance);
      if (gesture.axisDirection && direction !== gesture.axisDirection) gesture.pendingDistance = 0;
      gesture.axisDirection = direction;
      gesture.pendingDistance = Math.max(-threshold * 2, Math.min(threshold * 2, gesture.pendingDistance + distance));
    } else if (ending) return;
    if (Math.abs(gesture.pendingDistance) < threshold || now() - gesture.lastStep < stepInterval) return;
    const direction = Math.sign(gesture.pendingDistance);
    gesture.pendingDistance -= direction * threshold;
    gesture.stepped = true;
    gesture.phase = 'swiping';
    gesture.lastStep = now();
    endPreview(gesture);
    publish('swiping');
    options.onStep?.(fingerDirection(direction), gesture);
  }

  function move(event) {
    if (!active) return;
    const gesture = active;
    if (list(event.touches).length !== 1) { cancel('multitouch', true); return; }
    if (!valid(gesture)) { cancel('mode-change', true); return; }
    const touch = find(event.touches, gesture.id);
    if (!touch) { cancel('lost-touch', true); return; }
    const current = point(touch);
    if (gesture.pan) {
      if (!event.cancelable) { gesture.last = current; cancel('native-gesture', true); return; }
      event.preventDefault();
    }
    advance(gesture, current);
  }

  function end(event) {
    if (!active) return;
    const gesture = active;
    if (list(event.touches).length) { cancel('multitouch', true); return; }
    const touch = find(event.changedTouches, gesture.id);
    if (!touch || !valid(gesture)) { cancel('ended-outside-context'); return; }
    // Some Safari streams coalesce the final coordinate into touchend.
    advance(gesture, point(touch), true);
    const tap = !gesture.moved && !gesture.held && !gesture.stepped && (gesture.pan || now() - gesture.startTime <= 650) && ['overview', 'opening', 'open'].includes(gesture.mode);
    const consumed = gesture.pan || tap || gesture.held || gesture.stepped;
    if (consumed && event.cancelable) event.preventDefault();
    active = null;
    blocked = false;
    clearHold();
    unlistenGesture();
    endPreview(gesture);
    suppressClick(gesture);
    publish('idle');
    if (tap) options.onTap?.(gesture);
    options.onRelease?.({ ...gesture, reason: tap ? 'tap' : 'end', cancelled: false });
  }

  function touchCancel(event) {
    cancel('touchcancel', list(event.touches).length > 0);
  }

  function anyEnd(event) {
    const previousCount = touchCount;
    touchCount = list(event.touches).length;
    if (!active && touchCount === 0) {
      const wasBlocked = blocked;
      blocked = false;
      publish('idle');
      if (wasBlocked || previousCount > 0) options.onRelease?.({ reason: 'touches-released', cancelled: true });
    }
  }

  function compatibilityClick(event) {
    if (!suppression || event.detail === 0) return;
    if (now() > suppression.expires) { suppression = null; return; }
    if (event.pointerType && event.pointerType !== 'touch') return;
    if (event.sourceCapabilities && !event.sourceCapabilities.firesTouchEvents) return;
    const { start, end: last, target } = suppression;
    const near = Math.min(Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY), Math.hypot(event.clientX - last.clientX, event.clientY - last.clientY)) <= 44;
    const zeroAtSameTarget = event.clientX === 0 && event.clientY === 0 && (target === event.target || target.contains?.(event.target));
    if (!near && !zeroAtSameTarget) return;
    suppression = null;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function realPointerStart(event) {
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') suppression = null;
  }

  function contextMenu(event) {
    if (active && active.pan) event.preventDefault();
  }

  function hidden() {
    if (doc.hidden) {
      cancel('hidden', active !== null || touchCount > 0);
      touchCount = 0;
    } else if (!active) {
      // Safari may omit the final touchend while backgrounded. A cancelled
      // contact cannot resume, and must not block later quality restoration.
      blocked = false;
    }
    refresh();
  }

  surface.addEventListener('touchstart', start, { capture: true, passive: true });
  // Registered before touchstart, so Safari knows the first move is cancelable.
  // This listener never cancels native detail/list gestures or multiple touches.
  surface.addEventListener('touchmove', move, { capture: true, passive: false });
  surface.addEventListener('click', compatibilityClick, { capture: true });
  surface.addEventListener('contextmenu', contextMenu);
  doc.addEventListener('touchstart', anyStart, { capture: true, passive: true });
  doc.addEventListener('touchend', anyEnd, { capture: true, passive: true });
  doc.addEventListener('touchcancel', anyEnd, { capture: true, passive: true });
  doc.addEventListener('pointerdown', realPointerStart, { capture: true, passive: true });
  doc.addEventListener('visibilitychange', hidden);
  const observer = typeof win.MutationObserver === 'function' ? new win.MutationObserver(refresh) : null;
  observer?.observe(surface, { attributes: true, attributeFilter: ['data-archive-view'] });
  if (doc.body) observer?.observe(doc.body, { attributes: true, attributeFilter: ['class'] });
  for (const target of options.observeTargets || []) if (target) observer?.observe(target, { attributes: true, attributeFilter: ['hidden'] });
  refresh();
  publish('idle');

  return {
    ownsTouchPointers,
    ignoresPointer: event => ownsTouchPointers && (event?.pointerType === 'touch' || event?.sourceCapabilities?.firesTouchEvents === true),
    isActive: () => active !== null || blocked || touchCount > 0,
    getState: () => ({ phase: active?.phase || 'idle', axis: active?.axis || null, blocked, touchCount, hasSuppression: suppression !== null }),
    refresh,
    cancel: reason => cancel(reason || 'external-cancel', active !== null || blocked),
    destroy() {
      if (disposed) return;
      cancel('disposed');
      disposed = true;
      touchCount = 0;
      suppression = null;
      observer?.disconnect();
      surface.removeEventListener('touchstart', start, true);
      surface.removeEventListener('touchmove', move, true);
      surface.removeEventListener('click', compatibilityClick, true);
      surface.removeEventListener('contextmenu', contextMenu);
      doc.removeEventListener('touchstart', anyStart, true);
      doc.removeEventListener('touchend', anyEnd, true);
      doc.removeEventListener('touchcancel', anyEnd, true);
      doc.removeEventListener('pointerdown', realPointerStart, true);
      doc.removeEventListener('visibilitychange', hidden);
      for (const { element } of originalStyles) element.style.touchAction = 'auto';
      surface.style.userSelect = originalSelection.user;
      surface.style.webkitUserSelect = originalSelection.webkit;
      surface.style.webkitTouchCallout = originalSelection.callout;
      delete surface.dataset.touchNavigation;
      delete surface.dataset.touchGesture;
    },
  };
}
