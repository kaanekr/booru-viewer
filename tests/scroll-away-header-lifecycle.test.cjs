const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { loadScrollAwayHeader } = require('./helpers/scroll-away-header.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => { if (root) await act(async () => root.unmount()); root = undefined; });
const event = (y, content = 2500, viewport = 500) => ({ nativeEvent: {
  contentOffset: { x: 0, y }, contentSize: { width: 390, height: content }, layoutMeasurement: { width: 390, height: viewport },
} });

async function setup(options = {}) {
  const { hook, component, animations } = loadScrollAwayHeader();
  let controller; let renders = 0;
  function Harness(props) {
    renders++;
    controller = hook.useScrollAwayHeader(props);
    return React.createElement(component.ScrollAwayHeader, { controller, top: 44 }, React.createElement('Text', null, 'Controls'));
  }
  const props = { enabled: true, resetKey: 'feed-a', ...options };
  await act(async () => { root = create(React.createElement(Harness, props)); });
  await act(async () => controller.onHeaderLayout({ nativeEvent: { layout: { height: 120 } } }));
  return {
    get controller() { return controller; }, animations, get renders() { return renders; },
    scroll(y, content, viewport) { controller.onScroll(event(y, content, viewport)); },
    update: (next) => act(async () => root.update(React.createElement(Harness, { ...props, ...next }))),
  };
}

test('scrolling down collapses and reversing reveals smoothly 1:1 with native transforms, without per-scroll React renders', async () => {
  const s = await setup();
  const renders = s.renders;
  s.scroll(0);
  s.scroll(60);
  assert.equal(s.controller.translateY.value, -60);
  assert.equal(s.controller.occlusionRef.current, 60);
  s.scroll(200);
  assert.equal(s.controller.translateY.value, -120);
  assert.equal(s.controller.occlusionRef.current, 0);
  s.scroll(160); // reverse by 40px -> smooth continuous reveal
  assert.equal(s.controller.translateY.value, -80);
  assert.equal(s.controller.occlusionRef.current, 40);
  // Settle snaps smoothly to the nearest edge with native driver
  s.controller.settle();
  assert.equal(s.controller.translateY.value, -120);
  assert.equal(s.animations.length, 1);
  assert.equal(s.renders, renders);
  assert.ok(s.animations.every((a) => a.config.useNativeDriver && a.config.isInteraction === false));
});

test('pull-to-refresh and bottom rubber-band rebound cannot toggle the header spuriously', async () => {
  const s = await setup();
  s.scroll(0); s.scroll(200); s.scroll(1900);
  const count = s.animations.length;
  s.scroll(2100); s.scroll(2050); s.scroll(2000);
  assert.equal(s.animations.length, count);
  assert.equal(s.controller.translateY.value, -120);
  s.scroll(0); s.scroll(-70); s.scroll(-20); s.scroll(0);
  assert.equal(s.controller.translateY.value, 0);
});

test('short lists, empty states and pinned search/filter controls cannot be hidden', async () => {
  const s = await setup();
  s.scroll(0, 400); s.scroll(150, 400);
  assert.equal(s.animations.length, 0);
  assert.equal(s.controller.translateY.value, 0);
  await s.update({ pinned: true });
  s.scroll(0); s.scroll(800);
  assert.equal(s.controller.translateY.value, 0);
  await s.update({ enabled: false });
  assert.equal(s.controller.occlusionRef.current, 0);
  assert.equal(root.root.findByProps({ testID: 'scroll-away-header' }).props.style[1], false);
});

test('changing query/source or header measurement resets hidden state and stops old animations', async () => {
  const s = await setup();
  s.scroll(0); s.scroll(60);
  s.controller.settle();
  const animation = s.animations.at(-1);
  await s.update({ resetKey: 'feed-b' });
  assert.equal(s.controller.translateY.value, 0);
  assert.equal(animation.stopped, true);
  s.scroll(1000); s.scroll(1050);
  await act(async () => s.controller.onHeaderLayout({ nativeEvent: { layout: { height: 160.4 } } }));
  assert.equal(s.controller.height, 161);
  assert.equal(s.controller.translateY.value, 0);
});

test('unmount stops the native animation and leaves no timers/listeners behind', async () => {
  const s = await setup();
  s.scroll(0); s.scroll(50);
  s.controller.settle();
  const animation = s.animations.at(-1);
  await act(async () => root.unmount()); root = undefined;
  assert.equal(animation.stopped, true);
});
