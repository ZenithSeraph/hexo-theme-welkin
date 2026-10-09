import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { PerspectiveCamera, Vector3 } from '../source/assets/welkin/vendor/three.core.js';
import { articleIndexAt, classifyArchiveTarget, createWheelAccumulator, dominantAxis, fingerDirection, nearestArticleCell, normalizeWheelDelta, wheelDirection } from '../source/assets/welkin/archive-input.mjs';

function wheelFixture() {
  let time = 0, id = 0, enabled = true, ended = 0;
  const timers = new Map(), steps = [];
  const input = createWheelAccumulator({
    now: () => time, canRun: () => enabled,
    setTimer(fn, delay) { const token = ++id; timers.set(token, { fn, at: time + delay }); return token; },
    clearTimer: token => timers.delete(token),
    onStep: direction => steps.push({ direction, at: time }), onEnd: () => ended++,
  });
  function tick(ms) {
    const end = time + ms;
    while (true) {
      const next = [...timers].filter(([, item]) => item.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    time = end;
  }
  const push = (y, x = 0, deltaMode = 0, extra = {}) => input.push({ deltaX: x, deltaY: y, deltaMode, ...extra }, { width: 1280, height: 720 });
  return { input, steps, tick, push, disable: () => { enabled = false; }, ended: () => ended };
}

// Use the same Three camera convention as the production scene. Measure a
// fixed tile's translation, excluding the independent vertical standing wave.
for (const elevation of [19, 23]) {
  const yaw = 59 * Math.PI / 180, pitch = elevation * Math.PI / 180;
  const direction = new Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const camera = new PerspectiveCamera(3, 16 / 9, 10, 250);
  camera.position.copy(direction).multiplyScalar(100); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const origin = new Vector3(0, 0, 0).project(camera);
  const screenDelta = step => {
    const moved = new Vector3(0, 0, step * 0.365).project(camera);
    return { x: moved.x - origin.x, y: origin.y - moved.y };
  };
  for (const delta of [1, -1]) {
    const finger = screenDelta(fingerDirection(delta)), wheel = screenDelta(wheelDirection(delta));
    assert.equal(Math.sign(finger.x), delta); assert.equal(Math.sign(finger.y), delta);
    assert.equal(Math.sign(wheel.x), -delta); assert.equal(Math.sign(wheel.y), -delta);
  }
}
console.log('PASS real Three projection: fingers follow displacement; normalized wheel moves content oppositely');

for (const count of [1, 27, 100]) {
  for (let index = 0; index < count; index++) {
    const current = { column: 0, row: -index };
    assert.equal(articleIndexAt(current, count), index);
    const nextIndex = (index + 1) % count;
    const nextButton = nearestArticleCell(nextIndex, current, count);
    const wheelDown = { ...current, row: current.row + wheelDirection(1) };
    const fingerUp = { ...current, row: current.row + fingerDirection(-1) };
    assert.equal(articleIndexAt(nextButton, count), nextIndex);
    assert.equal(articleIndexAt(wheelDown, count), nextIndex);
    assert.equal(articleIndexAt(fingerUp, count), nextIndex);
    if (count > 1) assert.equal(nextButton.row, wheelDown.row);
    for (const column of [-2, 0, 2]) {
      const background = { column, row: current.row - 7 };
      const postIndex = articleIndexAt(background, count);
      assert(postIndex >= 0 && postIndex < count);
      const returned = nearestArticleCell(index, current, count);
      assert.equal(articleIndexAt(returned, count), index);
    }
  }
}
console.log('PASS 1/27/100 articles: next button, wheel down and finger up agree; background identities remain valid');

assert.deepEqual(normalizeWheelDelta({ deltaX: 2, deltaY: 3, deltaMode: 1 }), { x: 32, y: 48 });
assert.deepEqual(normalizeWheelDelta({ deltaX: 1, deltaY: 1, deltaMode: 2 }, { width: 1280, height: 720 }), { x: 1280, y: 720 });
assert.deepEqual(normalizeWheelDelta({ deltaX: NaN, deltaY: Infinity, deltaMode: 0 }), { x: 0, y: 0 });
assert.equal(dominantAxis(40, -39), 'x'); assert.equal(dominantAxis(39, -40), 'y'); assert.equal(dominantAxis(40, -40), 'y');

{
  const f = wheelFixture();
  for (let i = 0; i < 24; i++) { f.push(6); f.tick(8); }
  f.tick(500);
  assert.equal(f.steps.length, 3, 'small pixel events survive the emission cooldown');
  assert(f.steps.every(step => step.direction === -1));
  for (let i = 1; i < f.steps.length; i++) assert(f.steps[i].at - f.steps[i - 1].at >= 90);
  assert.equal(f.input.getState().pending, 0); assert.equal(f.input.getState().axis, null);
  assert.equal(f.ended(), 1);
}
{
  const f = wheelFixture();
  f.push(3, 0, 1); assert.deepEqual(f.steps.map(s => s.direction), [-1]);
  f.tick(100); f.push(-3, 0, 1); assert.deepEqual(f.steps.map(s => s.direction), [-1, 1]);
  f.input.destroy();
}
{
  const f = wheelFixture();
  f.push(40); f.tick(10); f.push(-20); f.tick(10); f.push(-28);
  assert.deepEqual(f.steps.map(s => s.direction), [1], 'a reversal clears pre-threshold opposite momentum');
  f.input.reset(); f.push(96); f.tick(20); f.push(-48); f.tick(90);
  assert.deepEqual(f.steps.slice(-2).map(s => s.direction), [-1, 1], 'queued old direction cannot fire after reversal');
  f.input.destroy();
}
{
  const f = wheelFixture();
  f.push(-39, 40); assert.equal(f.input.getState().axis, 'x');
  f.push(-81, 40); f.tick(100);
  assert(f.steps.every(step => step.direction === -1), 'diagonal Y noise cannot flip a locked X gesture');
  f.input.destroy();
}
{
  const f = wheelFixture();
  f.push(10000); f.tick(5000);
  assert.equal(f.steps.length, 2, 'large events have a bounded queue');
  f.push(30); f.tick(230); f.push(20); f.tick(230);
  assert.equal(f.steps.length, 2, 'incomplete tails are not carried into a later gesture');
  f.push(96); const before = f.steps.length; f.push(1, 0, 0, { ctrlKey: true }); f.tick(500);
  assert.equal(f.steps.length, before, 'pinch cancels the pending queue');
  f.push(96); const beforeDisabled = f.steps.length; f.disable(); f.tick(500);
  assert.equal(f.steps.length, beforeDisabled, 'detail/list/pause state is checked at timer delivery');
  f.input.destroy(); assert.equal(f.push(48), false);
}
console.log('PASS pixel/line/page units, small trackpad deltas, cadence, inertia end, reversal, diagonal lock and pinch cancellation');

{
  const f = wheelFixture();
  assert.equal(f.input.hasActiveSession(), false);
  assert.equal(f.push(48, 0, 0, { cancelable: false }), false);
  assert.equal(f.steps.length, 0, 'an initially native stream is not seized');
  assert.equal(f.push(3, 0, 0, { cancelable: true }), true);
  assert.equal(f.input.hasActiveSession(), true, 'small first delta establishes the owned stream');
  for (let i = 0; i < 15; i++) { f.tick(8); assert.equal(f.push(3, 0, 0, { cancelable: false }), true); }
  assert.deepEqual(f.steps.map(s => s.direction), [-1]);
  f.tick(230); assert.equal(f.input.hasActiveSession(), false);
  assert.equal(f.push(48, 0, 0, { cancelable: false }), false, 'idle timeout releases ownership');
  f.push(3, 0, 0, { cancelable: true }); f.input.reset();
  assert.equal(f.input.hasActiveSession(), false, 'new touch/reset releases ownership');
  assert.equal(f.push(48, 0, 0, { cancelable: false }), false);
  f.push(3, 0, 0, { cancelable: true }); f.push(3, 0, 0, { ctrlKey: true });
  assert.equal(f.input.hasActiveSession(), false, 'pinch releases ownership');
  f.input.destroy();
}
console.log('PASS cancelable first delta + noncancelable continuation; native starts, timeout, reset and pinch release');

// Exercise the actual stage wheel handler without a renderer: title acceptance,
// control exclusions, expanded-list/native scroll and ctrl zoom are contracts.
{
  const dom = new JSDOM('<section id="stage"><canvas id="canvas"></canvas><a id="feature-link"><h2 id="title">Title</h2></a><button id="next">Next</button><div id="detail-panel"><p id="text">Summary</p></div></section>');
  const doc = dom.window.document, stage = doc.getElementById('stage');
  const source = fs.readFileSync(new URL('../source/assets/welkin/glass-scene.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function wheel(event) {');
  const handler = source.slice(start, source.indexOf('\n  }', start) + 4);
  let enabled = true, accepted = 0, resets = 0;
  const context = vm.createContext({ stage, classifyArchiveTarget, canNavigateArchives: () => enabled,
    wheelInput: { reset: () => resets++, push: () => { accepted++; return true; } },
    cancelQualityRestore() {}, clearTitleHover() {}, clearDwell() {}, hoverCellKey: '', hoverLockedUntil: 0, performance: { now: () => 100 },
  });
  vm.runInContext(handler, context);
  function send(id, extra = {}) {
    let prevented = false;
    context.wheel({ target: doc.getElementById(id), cancelable: true, preventDefault() { prevented = true; }, ...extra });
    return prevented;
  }
  assert.equal(send('canvas'), true); assert.equal(send('title'), true); assert.equal(accepted, 2);
  assert.equal(send('next'), false); assert.equal(send('text'), false);
  assert.equal(send('title', { ctrlKey: true }), false);
  enabled = false; assert.equal(send('canvas'), false); assert(resets >= 4);
  enabled = true;
  const real = wheelFixture();
  context.wheelInput = real.input;
  assert.equal(send('title', { deltaY: 48, deltaX: 0, deltaMode: 0, cancelable: false }), false);
  assert.equal(real.steps.length, 0);
  assert.equal(send('title', { deltaY: 3, deltaX: 0, deltaMode: 0 }), true);
  for (let i = 0; i < 15; i++) {
    real.tick(8);
    assert.equal(send('title', { deltaY: 3, deltaX: 0, deltaMode: 0, cancelable: false }), false, 'continuation is accumulated without preventDefault');
  }
  assert.deepEqual(real.steps.map(s => s.direction), [-1]);
  real.input.destroy();
  dom.window.close();
}
console.log('PASS production stage wheel routing: canvas/title accepted; controls/detail/list/native zoom preserved');
