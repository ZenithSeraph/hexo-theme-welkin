import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createArchiveTouchGestures } from '../source/assets/welkin/touch-gestures.mjs';

// Dispatch actual DOM Touch-event streams through the shipped implementation.
// No browser, network, WebGL context or copied gesture algorithm is involved.
function fixture() {
  const dom = new JSDOM(`<body><main id="home"><section id="stage">
    <div id="mount"><canvas id="canvas"></canvas></div>
    <a id="feature-link" href="/article"><h2 id="heading">Article title</h2></a>
    <div class="archive-navigation"><span id="count">01 / 27</span><button id="next">Next</button></div>
    <button id="show">All articles</button>
    <div id="detail-panel"><p id="summary">A readable summary</p><a id="original" href="/original">Read</a></div>
  </section><section id="archive" hidden><input id="search"></section></main><div id="outside"></div></body>`, {
    url: 'https://test.example/', pretendToBeVisual: true,
  });
  const w = dom.window, d = w.document;
  const el = id => d.getElementById(id);
  let time = 0, timerId = 0, mode = 'overview', ready = true;
  const timers = new Map();
  const calls = { steps: [], taps: [], holds: 0, releases: 0, links: 0, buttons: 0 };
  el('feature-link').addEventListener('click', event => { event.preventDefault(); calls.links++; });
  el('next').addEventListener('click', () => calls.buttons++);
  el('show').addEventListener('click', () => calls.buttons++);
  el('mount').style.touchAction = el('canvas').style.touchAction = 'pan-y';
  const controller = createArchiveTouchGestures({
    surface: el('stage'), touchSurfaces: [el('mount'), el('canvas')],
    observeTargets: [el('home'), el('archive')], supportsTouchEvents: true,
    getMode: () => !ready || d.hidden || el('home').hidden ? 'inactive' : mode,
    canPan: () => ready && !d.hidden && !el('home').hidden && mode === 'overview' && el('archive').hidden && !d.body.classList.contains('articles-visible'),
    now: () => time,
    setTimer(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimer: id => timers.delete(id),
    onStep(direction) { calls.steps.push(direction); el('next').click(); },
    onTap(gesture) { calls.taps.push(gesture); if (gesture.kind === 'feature-link') el('feature-link').click(); },
    onHold() { calls.holds++; }, onRelease() { calls.releases++; },
  });
  function tick(ms) {
    const end = time + ms;
    while (true) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    time = end;
  }
  const contact = (id, x, y, target = el('canvas')) => ({ identifier: id, clientX: x, clientY: y, target });
  function touch(type, target, touches, changed = touches, cancelable = true) {
    const event = new w.Event(type, { bubbles: true, cancelable });
    Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changed } });
    target.dispatchEvent(event);
    return event;
  }
  function click(target, x, y, detail = 1) {
    const event = new w.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, detail, clientX: x, clientY: y });
    target.dispatchEvent(event);
    return event;
  }
  const setMode = value => { mode = value; el('stage').dataset.archiveView = value; controller.refresh(); };
  const actions = () => [el('stage'), el('mount'), el('canvas')].map(node => node.style.touchAction);
  return { w, d, el, controller, calls, tick, contact, touch, click, setMode, actions,
    failWebGL() { ready = false; controller.refresh(); },
    close() { controller.destroy(); dom.window.close(); },
  };
}

const tests = [];
const test = (name, run) => tests.push([name, run]);

test('Safari first tiny move is cancelled; all eight directions step before touchend', () => {
  for (const [dx, dy, expected] of [[-60, 0, -1], [60, 0, 1], [0, -60, -1], [0, 60, 1], [-45, -45, -1], [45, -45, -1], [-45, 45, 1], [45, 45, 1]]) {
    const f = fixture();
    try {
      assert.deepEqual(f.actions(), ['pinch-zoom', 'pinch-zoom', 'pinch-zoom']);
      const start = f.contact(1, 200, 200);
      assert.equal(f.touch('touchstart', f.el('canvas'), [start]).defaultPrevented, false);
      const tiny = f.contact(1, 201, 201);
      assert.equal(f.touch('touchmove', f.el('canvas'), [tiny]).defaultPrevented, true);
      assert.equal(f.calls.steps.length, 0);
      f.tick(20);
      const last = f.contact(1, 200 + dx, 200 + dy);
      f.touch('touchmove', f.el('canvas'), [last]);
      assert.deepEqual(f.calls.steps, [expected]);
      assert.equal(f.calls.buttons, 1, 'programmatic selection click is not suppressed');
      f.touch('touchend', f.el('canvas'), [], [last]);
      assert.equal(f.calls.taps.length, 0);
      assert.equal(f.controller.ignoresPointer({ pointerType: 'touch', type: 'pointercancel' }), true);
      assert.equal(f.controller.ignoresPointer({ pointerType: 'mouse' }), false);
      assert.equal(f.controller.ignoresPointer({ pointerType: 'pen' }), false);
    } finally { f.close(); }
  }
});

test('uncancelable/native streams never navigate; final changedTouches still handles a swipe', () => {
  const f = fixture();
  try {
    const start = f.contact(1, 100, 200), last = f.contact(1, 100, 140);
    f.touch('touchstart', f.el('canvas'), [start]);
    f.touch('touchmove', f.el('canvas'), [last], [last], false);
    f.touch('touchend', f.el('canvas'), [], [last]);
    assert.equal(f.calls.steps.length, 0);
    f.touch('touchstart', f.el('canvas'), [start]);
    f.touch('touchend', f.el('canvas'), [], [last]);
    assert.deepEqual(f.calls.steps, [-1]);
  } finally { f.close(); }
});

test('a diagonal drag locks its main axis and reverses from new finger movement', () => {
  const f = fixture();
  try {
    const target = f.el('canvas');
    f.touch('touchstart', target, [f.contact(1, 200, 200)]);
    f.touch('touchmove', target, [f.contact(1, 240, 161)]);
    assert.equal(f.controller.getState().axis, 'x');
    assert.deepEqual(f.calls.steps, [1]);
    f.tick(150);
    // Y becomes slightly larger and has the opposite sign; the locked X axis
    // must keep the content following rightward finger movement.
    f.touch('touchmove', target, [f.contact(1, 280, 119)]);
    assert.deepEqual(f.calls.steps, [1, 1]);
    f.tick(150);
    f.touch('touchmove', target, [f.contact(1, 240, 180)]);
    assert.deepEqual(f.calls.steps, [1, 1, -1]);
    f.touch('touchend', target, [], [f.contact(1, 240, 180)]);
    assert.equal(f.calls.steps.length, 3, 'release does not drain old drag excess');
  } finally { f.close(); }
});

test('title overlay swipes do not open; tap opens exactly once and new footer touches are never swallowed', () => {
  const f = fixture();
  try {
    const heading = f.el('heading'), start = f.contact(1, 200, 200, heading), last = f.contact(1, 200, 130, heading);
    f.touch('touchstart', heading, [start]); f.touch('touchmove', heading, [last]); f.touch('touchend', heading, [], [last]);
    assert.equal(f.click(f.el('feature-link'), 200, 130).defaultPrevented, true);
    assert.equal(f.calls.links, 0);
    f.touch('touchstart', heading, [start]); f.tick(80); f.touch('touchend', heading, [], [start]);
    assert.equal(f.calls.links, 1, 'tap activates the real title link, not a tile behind it');
    assert.equal(f.click(f.el('feature-link'), 200, 200).defaultPrevented, true);
    assert.equal(f.calls.links, 1, 'compatibility click cannot open a second time');
    f.el('feature-link').click(); assert.equal(f.calls.links, 2, 'keyboard/programmatic detail=0 remains allowed');
    f.touch('touchstart', heading, [start]); f.touch('touchmove', heading, [last]); f.touch('touchend', heading, [], [last]);
    const button = f.el('show'), nextTouch = f.contact(2, 200, 130, button);
    const before = f.calls.buttons;
    f.touch('touchstart', button, [nextTouch]); f.touch('touchend', button, [], [nextTouch]);
    assert.equal(f.click(button, 200, 130).defaultPrevented, false);
    assert.equal(f.calls.buttons, before + 1);
  } finally { f.close(); }
});

test('tap, hold, slop and cancellation remain separate and Pointer cancellation cannot consume touchend', () => {
  const f = fixture();
  try {
    const start = f.contact(7, 150, 200);
    f.touch('touchstart', f.el('canvas'), [start]);
    f.el('canvas').dispatchEvent(new f.w.Event('lostpointercapture', { bubbles: true }));
    f.tick(80); f.touch('touchend', f.el('canvas'), [], [start]);
    assert.equal(f.calls.taps.length, 1);
    f.touch('touchstart', f.el('canvas'), [start]); f.tick(299); assert.equal(f.calls.holds, 0);
    f.tick(1); assert.equal(f.calls.holds, 1);
    const dragged = f.contact(7, 150, 100);
    f.touch('touchmove', f.el('canvas'), [dragged]); f.touch('touchend', f.el('canvas'), [], [dragged]);
    assert.equal(f.calls.steps.length, 0); assert.equal(f.calls.taps.length, 1);
    f.touch('touchstart', f.el('canvas'), [start]);
    const slop = f.contact(7, 160, 200);
    f.touch('touchmove', f.el('canvas'), [slop]); f.tick(400); f.touch('touchend', f.el('canvas'), [], [slop]);
    assert.equal(f.calls.taps.length, 1); assert.equal(f.calls.holds, 1);
    f.touch('touchstart', f.el('canvas'), [start]); f.touch('touchcancel', f.el('canvas'), [], [start]); f.tick(500);
    assert.equal(f.calls.holds, 1); assert.equal(f.controller.isActive(), false);
  } finally { f.close(); }
});

test('two fingers including one outside the stage remain native until all contacts end', () => {
  const f = fixture();
  try {
    const one = f.contact(1, 150, 200), two = f.contact(2, 300, 200, f.el('outside'));
    f.touch('touchstart', f.el('canvas'), [one]);
    assert.equal(f.touch('touchstart', f.el('outside'), [one, two], [two]).defaultPrevented, false);
    assert.equal(f.controller.isActive(), true, 'multi-touch also keeps quality restoration locked');
    assert.equal(f.touch('touchmove', f.el('canvas'), [one, two]).defaultPrevented, false);
    f.touch('touchend', f.el('outside'), [one], [two]);
    const moved = f.contact(1, 150, 80);
    assert.equal(f.touch('touchmove', f.el('canvas'), [moved]).defaultPrevented, false);
    assert.equal(f.calls.steps.length, 0);
    f.touch('touchend', f.el('canvas'), [], [moved]); assert.equal(f.controller.isActive(), false);
    f.touch('touchstart', f.el('canvas'), [one]); f.touch('touchmove', f.el('canvas'), [moved]);
    assert.deepEqual(f.calls.steps, [-1]);
  } finally { f.close(); }
});

test('expanded lists, detail text, controls and mode changes restore native scrolling', async () => {
  const f = fixture();
  try {
    f.el('archive').hidden = false; f.d.body.classList.add('articles-visible'); await Promise.resolve();
    assert.deepEqual(f.actions(), ['auto', 'auto', 'auto']);
    let start = f.contact(1, 100, 200), last = f.contact(1, 100, 100);
    f.touch('touchstart', f.el('canvas'), [start]);
    assert.equal(f.touch('touchmove', f.el('canvas'), [last]).defaultPrevented, false);
    assert.equal(f.touch('touchend', f.el('canvas'), [], [last]).defaultPrevented, false);
    assert.equal(f.calls.steps.length, 0);
    f.setMode('open');
    for (const id of ['summary', 'original', 'next', 'count']) {
      const target = f.el(id); start = f.contact(1, 100, 200, target); last = f.contact(1, 100, 100, target);
      f.touch('touchstart', target, [start]); assert.equal(f.touch('touchmove', target, [last]).defaultPrevented, false); f.touch('touchend', target, [], [last]);
    }
    f.setMode('overview'); f.el('archive').hidden = true; f.d.body.classList.remove('articles-visible'); await Promise.resolve();
    assert.deepEqual(f.actions(), ['pinch-zoom', 'pinch-zoom', 'pinch-zoom']);
    start = f.contact(1, 100, 200); f.touch('touchstart', f.el('canvas'), [start]); f.setMode('opening');
    f.tick(500); f.touch('touchend', f.el('canvas'), [], [start]);
    assert.equal(f.calls.taps.length, 0); assert.equal(f.calls.holds, 0);
  } finally { f.close(); }
});

test('hide/show without contacts never leaves a quality lock; pause/failure/destroy clean up', () => {
  const f = fixture();
  try {
    Object.defineProperty(f.d, 'hidden', { configurable: true, value: true }); f.d.dispatchEvent(new f.w.Event('visibilitychange'));
    assert.equal(f.controller.isActive(), false);
    Object.defineProperty(f.d, 'hidden', { configurable: true, value: false }); f.d.dispatchEvent(new f.w.Event('visibilitychange'));
    assert.equal(f.controller.isActive(), false);
    const start = f.contact(1, 100, 200); f.touch('touchstart', f.el('canvas'), [start]);
    Object.defineProperty(f.d, 'hidden', { configurable: true, value: true }); f.d.dispatchEvent(new f.w.Event('visibilitychange'));
    f.tick(500); assert.equal(f.calls.holds, 0); assert.deepEqual(f.actions(), ['auto', 'auto', 'auto']);
    Object.defineProperty(f.d, 'hidden', { configurable: true, value: false }); f.d.dispatchEvent(new f.w.Event('visibilitychange'));
    assert.equal(f.controller.isActive(), false, 'missing backgrounded touchend cannot leave a stale lock');
    f.failWebGL(); assert.deepEqual(f.actions(), ['auto', 'auto', 'auto']);
    f.controller.destroy(); assert.deepEqual(f.actions(), ['auto', 'auto', 'auto']);
    f.touch('touchstart', f.el('canvas'), [start]); f.tick(500); assert.equal(f.calls.holds, 0);
  } finally { f.close(); }
});

for (const [name, run] of tests) {
  await run();
  console.log(`PASS ${name}`);
}
console.log(`Touch gesture regression tests passed (${tests.length} groups).`);
