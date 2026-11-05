const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./helpers/load-typescript.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => { if (root) await act(() => root.unmount()); root = undefined; });

function setup() {
  const listeners = new Set();
  let nextRead;
  const appState = {
    currentState: 'active',
    addEventListener: (_event, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; },
  };
  const navigator = () => ({ Navigator: 'Navigator', Screen: 'Screen' });
  const mocks = {
    react: React,
    'react-native': { AppState: appState, StyleSheet: { create: (v) => v }, View: 'View', StatusBar: 'StatusBar' },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider' },
    'expo-status-bar': { StatusBar: 'ExpoStatusBar' }, 'lucide-react-native': {},
    'expo-haptics': {}, 'expo-screen-orientation': { lockAsync: async () => {}, OrientationLock: { PORTRAIT_UP: 'portrait' } },
    './src/services/securityService': { SecurityService: { isPasscodeEnabled: async () => nextRead ? nextRead() : true } },
    './src/services/storage': { StorageService: { getGridPreviews: async () => true } },
    './src/services/proxyService': { proxyService: { init: async () => {} } },
    './src/services/booruApi': { booruApi: {} }, './src/components/LockScreen': { LockScreen: 'LockScreen' },
    './src/theme/colors': { Colors: { dark: {} } },
    '@react-navigation/native': { NavigationContainer: 'NavigationContainer' },
    '@react-navigation/native-stack': { createNativeStackNavigator: navigator },
    '@react-navigation/bottom-tabs': { createBottomTabNavigator: navigator },
    './src/navigation/rootNavigation': { navigationRef: React.createRef() },
    './src/context/SourceContext': {
      SourceProvider: ({ children }) => children,
      useSource: () => ({ isReady: true, activeSource: { id: 'a', type: 'danbooru' } }),
    },
    './src/utils/gridPreviews': { setGridPreviewsEnabled() {} },
    './src/utils/freezeProbe': { startFreezeProbe() {}, updateFreezeProbe() {}, recordFreezeEvent() {}, recordRootTouch() {} },
  };
  for (const name of ['Viewer', 'SearchDetail', 'Feed', 'Search', 'Favorites', 'Settings']) mocks[`./src/screens/${name}Screen`] = { [`${name}Screen`]: name };
  const App = createLoader(mocks)(path.resolve(__dirname, '../App.tsx')).default;
  return {
    App,
    readNext: (fn) => { nextRead = fn; },
    async emit(state) {
      appState.currentState = state;
      await act(async () => { for (const fn of listeners) void fn(state); });
    },
  };
}
const covered = () => root.root.findAllByProps({ testID: 'app-privacy-cover' }).length > 0;

test('inactive covers private content without re-mounting the unlocked passcode screen', async () => {
  const { App, emit } = setup();
  await act(() => { root = create(React.createElement(App)); });
  await act(() => root.root.findByType('LockScreen').props.onSuccess());
  await emit('inactive');
  assert.equal(covered(), true);
  assert.equal(root.root.findAllByType('LockScreen').length, 0);
  await emit('active');
  assert.equal(covered(), false);
});

test('background still locks; a pending security read covers the app even after foregrounding', async () => {
  const { App, emit, readNext } = setup();
  await act(() => { root = create(React.createElement(App)); });
  await act(() => root.root.findByType('LockScreen').props.onSuccess());
  let resolve;
  readNext(() => new Promise((done) => { resolve = done; }));
  await emit('background');
  await emit('active');
  assert.equal(covered(), true);
  await act(() => resolve(true));
  assert.equal(covered(), false);
  assert.equal(root.root.findAllByType('LockScreen').length, 1);
});

test('an older background check cannot dismiss the newest pending privacy cover', async () => {
  const { App, emit, readNext } = setup();
  await act(() => { root = create(React.createElement(App)); });
  await act(() => root.root.findByType('LockScreen').props.onSuccess());
  const reads = [];
  readNext(() => new Promise((resolve) => reads.push(resolve)));
  await emit('background'); await emit('active');
  await emit('background'); await emit('active');
  await act(async () => { reads[0](false); });
  assert.equal(covered(), true);
  await act(async () => { reads[1](true); });
  assert.equal(covered(), false);
  assert.equal(root.root.findAllByType('LockScreen').length, 1);
});
