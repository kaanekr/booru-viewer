const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./helpers/load-typescript.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => { if (root) await act(() => root.unmount()); root = undefined; });

function setup({ onNavRender } = {}) {
  const listeners = new Set();
  let nextRead;
  let sourceSetter;
  const appState = {
    currentState: 'active',
    addEventListener: (_event, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; },
  };
  const navigator = () => ({ Navigator: 'Navigator', Screen: 'Screen' });
  const NavigationContainerSpy = (props) => {
    onNavRender?.();
    return React.createElement('NavigationContainer', props);
  };
  const SourceCtx = React.createContext({
    isReady: true,
    activeSource: { id: 'a', type: 'danbooru' },
    selectSource: async () => {},
    init: async () => {},
  });
  const mocks = {
    react: React,
    'react-native': { AppState: appState, Platform: { OS: 'ios' }, StyleSheet: { create: (v) => v }, View: 'View', StatusBar: 'StatusBar' },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider' },
    'expo-status-bar': { StatusBar: 'ExpoStatusBar' }, 'lucide-react-native': {},
    'expo-haptics': {}, 'expo-screen-orientation': { lockAsync: async () => {}, OrientationLock: { PORTRAIT_UP: 'portrait' } },
    './src/services/securityService': { SecurityService: { isPasscodeEnabled: async () => nextRead ? nextRead() : true } },
    './src/services/storage': { StorageService: { getGridPreviews: async () => true } },
    './src/services/proxyService': { proxyService: { init: async () => {} } },
    './src/services/booruApi': { booruApi: {} }, './src/components/LockScreen': { LockScreen: 'LockScreen' },
    './src/theme/colors': { Colors: { dark: {} } },
    '@react-navigation/native': { NavigationContainer: NavigationContainerSpy },
    '@react-navigation/native-stack': { createNativeStackNavigator: navigator },
    '@react-navigation/bottom-tabs': { createBottomTabNavigator: navigator },
    './src/navigation/rootNavigation': { navigationRef: React.createRef() },
    './src/context/SourceContext': {
      SourceProvider: ({ children }) => {
        const [activeSource, setActiveSource] = React.useState({ id: 'a', type: 'danbooru' });
        sourceSetter = setActiveSource;
        const value = React.useMemo(
          () => ({ isReady: true, activeSource, selectSource: async (s) => setActiveSource(s), init: async () => {} }),
          [activeSource]
        );
        return React.createElement(SourceCtx.Provider, { value }, children);
      },
      useSource: () => React.useContext(SourceCtx),
    },
    './src/utils/gridPreviews': { setGridPreviewsEnabled() {} },
    './src/utils/videoFallbackCache': { syncNativeVideoCacheSize: async () => {} },
    './src/utils/freezeProbe': { startFreezeProbe() {}, updateFreezeProbe() {}, recordFreezeEvent() {}, recordRootTouch() {} },
  };
  for (const name of ['Viewer', 'SearchDetail', 'Feed', 'Search', 'Favorites', 'Settings']) mocks[`./src/screens/${name}Screen`] = { [`${name}Screen`]: name };
  const App = createLoader(mocks)(path.resolve(__dirname, '../App.tsx')).default;
  return {
    App,
    readNext: (fn) => { nextRead = fn; },
    async setSource(next) {
      await act(async () => { sourceSetter?.(next); });
    },
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

test('inactive during biometric prompt while locked does not cover LockScreen', async () => {
  const { App, emit } = setup();
  await act(() => { root = create(React.createElement(App)); });
  assert.equal(root.root.findAllByType('LockScreen').length, 1);
  await emit('inactive');
  assert.equal(covered(), false);
  assert.equal(root.root.findAllByType('LockScreen').length, 1);
});

test('AppState and activeSource changes do not re-render NavigationContainer', async () => {
  let navRenders = 0;
  const { App, emit, setSource } = setup({ onNavRender: () => { navRenders += 1; } });
  await act(() => { root = create(React.createElement(App)); });
  await act(() => root.root.findByType('LockScreen').props.onSuccess());
  const baseline = navRenders;
  await emit('inactive');
  await emit('active');
  await setSource({ id: 'b', type: 'gelbooru' });
  assert.equal(navRenders, baseline);
});

test('PasscodeModal + LockScreen completes multi-step setup and keeps Modal mounted when closed', async () => {
  const savedPins = [];
  const animatedStub = {
    Value: class { constructor(v) { this.v = v; } },
    View: 'AnimatedView',
    timing: () => ({ start: (cb) => cb?.() }),
    sequence: () => ({ start: (cb) => cb?.() }),
  };
  const lockMocks = {
    react: React,
    'react-native': {
      Animated: animatedStub,
      StyleSheet: { create: (v) => v },
      Text: 'Text',
      TouchableOpacity: 'TouchableOpacity',
      View: 'View',
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'expo-status-bar': { StatusBar: 'ExpoStatusBar' },
    'lucide-react-native': new Proxy({}, { get: (_, n) => String(n) }),
    'expo-haptics': { impactAsync: async () => {}, notificationAsync: async () => {}, ImpactFeedbackStyle: {}, NotificationFeedbackType: {} },
    '../services/securityService': {
      SecurityService: {
        getConfig: async () => ({ enabled: false, useBiometrics: false }),
        getBiometricStatus: async () => ({ hasHardware: false, isEnrolled: false, biometryType: null }),
        verifyPasscode: async () => true,
        setPasscode: async (p) => { savedPins.push(p); },
        disablePasscode: async () => {},
      },
    },
    '../theme/colors': { Colors: { dark: { textMuted: '#888' } } },
  };
  const { LockScreen } = createLoader(lockMocks)(path.resolve(__dirname, '../src/components/LockScreen.tsx'));
  const modalMocks = {
    react: React,
    'react-native': { Modal: 'Modal', StyleSheet: { create: (v) => v }, View: 'View' },
    './LockScreen': { LockScreen },
    '../services/securityService': lockMocks['../services/securityService'],
  };
  const { PasscodeModal } = createLoader(modalMocks)(path.resolve(__dirname, '../src/components/PasscodeModal.tsx'));
  let closed = 0;
  let succeeded = 0;
  await act(async () => {
    root = create(React.createElement(PasscodeModal, {
      visible: true,
      mode: 'setup',
      onClose: () => { closed += 1; },
      onSuccess: () => { succeeded += 1; },
    }));
  });
  const pressDigit = async (digit) => {
    const btn = root.root.findAllByType('TouchableOpacity').find((n) =>
      n.findAllByType('Text').some((t) => t.props.children === digit)
    );
    await act(async () => { await btn.props.onPress(); });
  };
  for (const d of ['1', '2', '3', '4']) await pressDigit(d);
  assert.ok(root.root.findAllByType('Text').some((t) => t.props.children === 'Verify Passcode'));
  for (const d of ['1', '2', '3', '4']) await pressDigit(d);
  assert.deepEqual(savedPins, ['1234']);
  assert.equal(succeeded, 1);
  assert.equal(closed, 1);
  await act(async () => {
    root.update(React.createElement(PasscodeModal, { visible: false, mode: 'setup', onClose() {}, onSuccess() {} }));
  });
  assert.equal(root.root.findByType('Modal').props.visible, false);
});

test('LockScreen auto-prompt uses fresh biometryType, blocks concurrent prompts, and guards delete during error/submit', async () => {
  const bioPrompts = [];
  let resolveBio;
  let resolveVerify;
  const animatedStub = {
    Value: class { constructor(v) { this.v = v; } },
    View: 'AnimatedView',
    timing: () => ({ start: (cb) => cb?.() }),
    sequence: () => ({ start: (cb) => cb?.() }),
  };
  const { LockScreen } = createLoader({
    react: React,
    'react-native': {
      Animated: animatedStub,
      StyleSheet: { create: (v) => v },
      Text: 'Text',
      TouchableOpacity: 'TouchableOpacity',
      View: 'View',
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'expo-status-bar': { StatusBar: 'ExpoStatusBar' },
    'lucide-react-native': new Proxy({}, { get: (_, n) => String(n) }),
    'expo-haptics': { impactAsync: async () => {}, notificationAsync: async () => {}, ImpactFeedbackStyle: {}, NotificationFeedbackType: {} },
    '../services/securityService': {
      SecurityService: {
        getConfig: async () => ({ enabled: true, useBiometrics: true }),
        getBiometricStatus: async () => ({ hasHardware: true, isEnrolled: true, biometryType: 'Face ID' }),
        authenticateWithBiometrics: (msg) => {
          bioPrompts.push(msg);
          return new Promise((r) => { resolveBio = r; });
        },
        verifyPasscode: () => new Promise((r) => { resolveVerify = r; }),
      },
    },
    '../theme/colors': { Colors: { dark: { textMuted: '#888' } } },
  })(path.resolve(__dirname, '../src/components/LockScreen.tsx'));

  await act(async () => {
    root = create(React.createElement(LockScreen, { mode: 'unlock', onSuccess() {} }));
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  assert.deepEqual(bioPrompts, ['Unlock with Face ID']);

  // Tapping biometric button while prompt is already in-flight must not start a concurrent prompt
  const bioBtn = root.root.findAllByType('TouchableOpacity').find((n) => n.findAllByType('ScanFace').length > 0);
  assert.ok(bioBtn);
  await act(async () => { bioBtn.props.onPress({ nativeEvent: {} }); });
  assert.equal(bioPrompts.length, 1);

  await act(async () => { resolveBio(false); await Promise.resolve(); });

  // Enter 4 digits -> in-flight verification -> delete must be ignored while submitting
  const pressDigit = async (digit) => {
    const btn = root.root.findAllByType('TouchableOpacity').find((n) =>
      n.findAllByType('Text').some((t) => t.props.children === digit)
    );
    await act(async () => { btn.props.onPress(); });
  };
  for (const d of ['1', '2', '3', '4']) await pressDigit(d);
  const delBtnWhileSubmitting = root.root.findAllByType('TouchableOpacity').find((n) => n.findAllByType('Delete').length > 0);
  assert.ok(delBtnWhileSubmitting);
  await act(async () => { delBtnWhileSubmitting.props.onPress(); });

  // Complete verification as failed -> enters error state -> delete must remain blocked during error shake/timer
  await act(async () => { resolveVerify(false); await Promise.resolve(); });
  assert.ok(root.root.findAllByType('Text').some((t) => t.props.children === 'Incorrect Passcode'));
  const delBtnDuringError = root.root.findAllByType('TouchableOpacity').find((n) => n.findAllByType('Delete').length > 0);
  if (delBtnDuringError) {
    await act(async () => { delBtnDuringError.props.onPress(); });
  }
  // Still shows error message because delete was ignored during error state
  assert.ok(root.root.findAllByType('Text').some((t) => t.props.children === 'Incorrect Passcode'));
});
