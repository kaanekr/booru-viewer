const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { setupSettings } = require('./helpers/settings-screen.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => { if (root) await act(() => root.unmount()); root = undefined; });

const button = (label) => root.root.findAllByType('TouchableOpacity').find((node) => node.props.accessibilityLabel === label);
const click = async (label) => act(async () => { await button(label).props.onPress(); });
const sourceButtons = () => root.root.findAllByType('TouchableOpacity').filter((node) => node.props.accessibilityRole === 'radio');
const mount = async (Screen, props) => act(async () => { root = create(React.createElement(Screen, props)); });

test('settings home is compact; source credentials live only in that source detail', async () => {
  const { Screen, selections } = setupSettings();
  await mount(Screen);
  assert.equal(root.root.findAllByType('TextInput').length, 0);
  await click('Choose source');
  assert.equal(sourceButtons().length, 4);
  assert.equal(button('Use Sex.com'), undefined);
  await click('Rule34.xxx settings');
  assert.equal(selections.length, 0, 'configuring a source must not activate it');
  assert.equal(root.root.findAllByProps({ placeholder: 'Rule34 api_key' }).length, 1);
  assert.equal(root.root.findAllByProps({ placeholder: 'Gelbooru api_key' }).length, 0);
  await click('Back to settings');
  await click('Gelbooru settings');
  assert.equal(root.root.findAllByProps({ placeholder: 'Rule34 api_key' }).length, 0);
  assert.equal(root.root.findAllByProps({ placeholder: 'Gelbooru api_key' }).length, 1);
});

test('source list shows every visible source with no search or filters', async () => {
  const { Screen } = setupSettings();
  await mount(Screen);
  await click('Choose source');
  assert.equal(sourceButtons().length, 4);
  assert.equal(button('Use Sex.com'), undefined);
  assert.equal(root.root.findAllByProps({ placeholder: 'Search sources' }).length, 0);
  assert.equal(root.root.findAllByType('TouchableOpacity').filter((node) => node.props.accessibilityRole === 'tab').length, 0);
});

test('selecting a source updates the shared active state without opening its settings', async () => {
  const { Screen, selections } = setupSettings();
  await mount(Screen);
  await click('Choose source');
  await click('Use RedGifs');
  assert.deepEqual(selections, ['redgifs']);
  assert.equal(button('Use RedGifs').props.accessibilityState.selected, true);
  assert.equal(button('Use Rule34.xxx').props.accessibilityState.selected, false);
  assert.equal(root.root.findAllByProps({ placeholder: 'Rule34 api_key' }).length, 0);
});

test('feed/search navigation can open sources directly and consumes the section parameter', async () => {
  const { Screen } = setupSettings();
  const updates = [];
  await mount(Screen, { route: { params: { section: 'sources' } }, navigation: { setParams: (value) => updates.push(value) } });
  assert.ok(button('Use Rule34.xxx'));
  assert.equal(updates.length, 1);
  assert.equal(updates[0].section, undefined);
});

test('relay URL edits are drafts until explicitly saved and cannot enable an empty relay', async () => {
  const { Screen, proxyWrites, alerts } = setupSettings();
  await mount(Screen);
  await click('Connection');
  const toggle = () => root.root.findByType('Switch');
  await act(async () => toggle().props.onValueChange(true));
  assert.equal(proxyWrites.length, 0);
  assert.equal(alerts[0][0], 'Worker URL required');
  const input = () => root.root.findByProps({ accessibilityLabel: 'Worker URL' });
  await act(() => input().props.onChangeText('https://relay.test/'));
  assert.equal(proxyWrites.length, 0);
  await click('Save URL');
  assert.equal(proxyWrites[0].workerUrl, 'https://relay.test');
  await act(async () => toggle().props.onValueChange(true));
  assert.equal(proxyWrites[1].enabled, true);
  await click('Remove Worker');
  assert.equal(proxyWrites[2].workerUrl, '');
  assert.equal(proxyWrites[2].enabled, false);
});

test('relay configuration rejects insecure URLs without replacing saved configuration', async () => {
  const { Screen, proxyWrites, alerts } = setupSettings({ proxy: { enabled: true, workerUrl: 'https://existing.test' } });
  await mount(Screen);
  await click('Connection');
  await act(() => root.root.findByProps({ accessibilityLabel: 'Worker URL' }).props.onChangeText('http://bad.test?url=target'));
  await click('Save URL');
  assert.equal(proxyWrites.length, 0);
  assert.equal(alerts[0][0], 'Invalid Worker URL');
});

test('a failed relay save does not show a saved status or activate the draft', async () => {
  const { Screen, proxyWrites, alerts } = setupSettings({ failWrite: true });
  await mount(Screen);
  await click('Connection');
  await act(() => root.root.findByProps({ accessibilityLabel: 'Worker URL' }).props.onChangeText('https://relay.test'));
  await click('Save URL');
  assert.equal(proxyWrites.length, 0);
  assert.equal(alerts[0][0], 'Could not save changes');
  assert.equal(button('Remove Worker'), undefined);
});

test('viewing changes preserve the preview preference and Android back navigates within settings', async () => {
  const { Screen, previewWrites, back } = setupSettings();
  await mount(Screen);
  await click('Viewing');
  await act(async () => root.root.findByProps({ accessibilityLabel: 'Video previews' }).props.onValueChange(false));
  assert.deepEqual(previewWrites, [false]);
  await act(() => { assert.equal(back(), true); });
  assert.ok(button('Choose source'));
});
