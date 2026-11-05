const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { setupSettings: setup } = require('./helpers/settings-screen.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => { if (root) await act(() => root.unmount()); root = undefined; });

const input = (placeholder) => root.root.findByProps({ placeholder });
const button = (label) => root.root.findAllByType('TouchableOpacity').find((node) => node.props.accessibilityLabel === label);
const savedLabel = () => root.root.findAllByType('Text').some((node) => node.children.join('').includes('Saved — Rule34'));
const mount = async (Screen) => {
  await act(async () => { root = create(React.createElement(Screen)); });
  await act(() => { button('Choose source').props.onPress(); });
  await act(() => { button('Rule34.xxx settings').props.onPress(); });
};

test('Rule34 settings save and delete credentials independently, masking the API key', async () => {
  const { Screen, writes } = setup();
  await mount(Screen);
  assert.equal(input('Rule34 api_key').props.secureTextEntry, true);
  await act(() => {
    input('Rule34 user_id').props.onChangeText(' 123 ');
    input('Rule34 api_key').props.onChangeText(' test-key ');
  });
  await act(async () => { await button('Save').props.onPress(); });
  assert.equal(writes[0].userId, '123');
  assert.equal(writes[0].apiKey, 'test-key');
  assert.equal(savedLabel(), true);
  await act(async () => { await button('Delete Key').props.onPress(); });
  assert.equal(writes[1].apiKey, '');
  assert.equal(input('Rule34 api_key').props.value, '');
  assert.equal(savedLabel(), false);
});

test('Rule34 settings reload the saved key and validate both fields before saving', async () => {
  const { Screen, writes, alerts } = setup({ saved: { userId: '123', apiKey: 'saved-test-key' } });
  await mount(Screen);
  assert.equal(input('Rule34 api_key').props.value, 'saved-test-key');
  assert.equal(savedLabel(), true);
  await act(() => { input('Rule34 user_id').props.onChangeText('not-a-number'); });
  assert.equal(savedLabel(), false);
  await act(async () => { await button('Save').props.onPress(); });
  assert.equal(writes.length, 0);
  assert.equal(alerts[0][0], 'Missing Info');
});

test('Rule34 settings never report success when credential persistence fails', async () => {
  const { Screen, alerts } = setup({ failWrite: true });
  await mount(Screen);
  await act(() => {
    input('Rule34 user_id').props.onChangeText('123');
    input('Rule34 api_key').props.onChangeText('test-key');
  });
  await act(async () => { await button('Save').props.onPress(); });
  assert.equal(savedLabel(), false);
  assert.equal(alerts[0][0], 'Could not save changes');
});
