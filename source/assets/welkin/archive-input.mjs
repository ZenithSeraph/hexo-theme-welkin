/* Input policy for the fixed upper-left / lower-right archive flow.
 * Positive scene steps move visible content down/right. Fingers follow their
 * displacement; normalized WheelEvent deltas move content in the opposite way.
 * No platform, user-agent, or guessed device-direction inversion is applied.
 */
export const dominantAxis = (x, y) => Math.abs(y) >= Math.abs(x) ? 'y' : 'x';
export const axisValue = (axis, x, y) => axis === 'x' ? x : y;
export const fingerDirection = value => Math.sign(value) || 0;
export const wheelDirection = value => -Math.sign(value) || 0;
const modulo = (value, count) => ((value % count) + count) % count;

export function articleIndexAt(cell, count, columnOffset = Math.max(1, Math.ceil(count / 5))) {
  return modulo(-cell.row + cell.column * columnOffset, count);
}

export function nearestArticleCell(index, cell, count, columnOffset) {
  const difference = modulo(index - articleIndexAt(cell, count, columnOffset) + count / 2, count) - count / 2;
  return { column: cell.column, row: cell.row - difference };
}

export function normalizeWheelDelta(event, page = {}) {
  const finite = value => Number.isFinite(value) ? value : 0;
  const unitX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, page.width || 1) : 1;
  const unitY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? Math.max(1, page.height || 1) : 1;
  return { x: finite(event.deltaX) * unitX, y: finite(event.deltaY) * unitY };
}

export function classifyArchiveTarget(target, surface) {
  const element = target?.nodeType === 1 ? target : target?.parentElement;
  if (!element || !surface.contains(element)) return null;
  if (element.closest('button, input, select, textarea, summary, [contenteditable]:not([contenteditable="false"]), [role="textbox"], #detail-panel, .detail-panel, .archive-navigation')) return null;
  const link = element.closest('a[href]');
  if (link && link.id !== 'feature-link') return null;
  return { target: element, kind: link ? 'feature-link' : 'scene' };
}

export function createWheelAccumulator(options) {
  const now = options.now || (() => performance.now());
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  const canRun = options.canRun || (() => true);
  const distance = options.distance ?? 48;
  const cadence = options.cadence ?? 90;
  const idleGap = options.idleGap ?? 220;
  const capacity = distance * (options.maxQueuedSteps ?? 2);
  const axisThreshold = options.axisThreshold ?? 8;
  let axis = null;
  let intentX = 0;
  let intentY = 0;
  let pending = 0;
  let lastDirection = 0;
  let lastInput = -Infinity;
  let lastStep = -Infinity;
  let drainTimer = 0;
  let idleTimer = 0;
  let generation = 0;
  let disposed = false;

  function hasActiveSession() {
    return !disposed && canRun() && Number.isFinite(lastInput) && now() - lastInput <= idleGap;
  }

  function reset() {
    if (drainTimer) clearTimer(drainTimer);
    if (idleTimer) clearTimer(idleTimer);
    drainTimer = idleTimer = 0;
    axis = null;
    intentX = intentY = pending = lastDirection = 0;
    lastInput = lastStep = -Infinity;
    generation += 1;
  }

  function scheduleEnd() {
    if (idleTimer) clearTimer(idleTimer);
    const token = generation;
    idleTimer = setTimer(() => {
      if (token !== generation) return;
      idleTimer = 0;
      reset(); // An incomplete inertia tail never becomes a synthetic step.
      options.onEnd?.();
    }, idleGap);
  }

  function drain() {
    drainTimer = 0;
    if (disposed || !canRun()) { reset(); return; }
    if (Math.abs(pending) + 1e-8 < distance) return;
    const delay = Math.max(0, cadence - (now() - lastStep));
    if (delay > 0) {
      const token = generation;
      drainTimer = setTimer(() => { if (token === generation) drain(); }, delay);
      return;
    }
    const direction = Math.sign(pending);
    pending -= direction * distance;
    lastStep = now();
    options.onStep(wheelDirection(direction));
    if (Math.abs(pending) + 1e-8 >= distance) drain();
  }

  function push(event, page) {
    if (disposed || event.ctrlKey || !canRun() || (event.cancelable === false && !hasActiveSession())) { reset(); return false; }
    const delta = normalizeWheelDelta(event, page);
    if (!delta.x && !delta.y) return false;
    if (now() - lastInput > idleGap) reset();
    lastInput = now();
    scheduleEnd();
    let amount;
    if (!axis) {
      intentX += delta.x;
      intentY += delta.y;
      if (Math.hypot(intentX, intentY) < axisThreshold) return true;
      axis = dominantAxis(intentX, intentY);
      amount = axisValue(axis, intentX, intentY);
      intentX = intentY = 0;
    } else amount = axisValue(axis, delta.x, delta.y);
    if (Math.abs(amount) < 0.01) return true;
    const direction = Math.sign(amount);
    if (lastDirection && direction !== lastDirection) {
      // A reversal owns the next step; old momentum is not allowed to fire later.
      pending = 0;
      if (drainTimer) clearTimer(drainTimer);
      drainTimer = 0;
      generation += 1;
      scheduleEnd();
    }
    lastDirection = direction;
    pending = Math.max(-capacity, Math.min(capacity, pending + amount));
    if (!drainTimer) drain();
    return true;
  }

  return {
    push, reset, hasActiveSession,
    getState: () => ({ axis, pending, hasPendingStep: Boolean(drainTimer), lastDirection }),
    destroy() { reset(); disposed = true; },
  };
}
