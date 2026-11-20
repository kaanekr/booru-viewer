const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => {
  if (root) await act(() => root.unmount());
  root = undefined;
});

function loadSheet({ os = 'ios', source = { id: 'a', name: 'A' }, selectSource = async () => {}, rule34Auth = { userId: '', apiKey: '' } } = {}) {
  const calls = { selected: [], closed: 0, managed: 0, authReads: 0 };
  const mocks = {
    react: React,
    'react-native': {
      Platform: { OS: os },
      StyleSheet: { create: (v) => v },
      ...Object.fromEntries(
        ['Modal', 'KeyboardAvoidingView', 'ScrollView', 'Text', 'TouchableOpacity', 'View'].map((n) => [n, n])
      ),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'lucide-react-native': { Settings2: 'Settings2', X: 'X' },
    'expo-haptics': { selectionAsync() {} },
    '../context/SourceContext': {
      useSource: () => ({
        activeSource: source,
        selectSource: async (next) => {
          calls.selected.push(next.id);
          await selectSource(next);
        },
      }),
    },
    '../services/storage': { StorageService: { getRule34Auth: async () => { calls.authReads += 1; return rule34Auth; } } },
    './SourceCatalog': {
      SourceCatalog: 'SourceCatalog',
    },
    '../theme/colors': { Colors: { dark: {} } },
  };
  const filename = path.resolve(__dirname, '../src/components/SourceSheet.tsx');
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    js,
    {
      module,
      exports: module.exports,
      require: (id) => {
        if (!(id in mocks)) throw new Error(`Unexpected dependency: ${id}`);
        return mocks[id];
      },
      console,
    },
    { filename }
  );
  return { SourceSheet: module.exports.SourceSheet, calls };
}

test('closed sheet stays hidden and does not query credentials', async () => {
  const { SourceSheet, calls } = loadSheet();
  await act(async () => {
    root = create(React.createElement(SourceSheet, { visible: false, onClose() {} }));
  });
  assert.equal(root.root.findByType('Modal').props.visible, false);
  assert.equal(calls.authReads, 0);
});

test('open sheet shows catalog and flags a missing Rule34 key', async () => {
  const { SourceSheet } = loadSheet({ rule34Auth: { userId: '', apiKey: '' } });
  await act(async () => {
    root = create(React.createElement(SourceSheet, { visible: true, onClose() {} }));
  });
  const catalog = root.root.findByType('SourceCatalog');
  assert.equal(catalog.props.credentials.rule34, false);
});

test('open sheet hides the key warning when credentials exist', async () => {
  const { SourceSheet } = loadSheet({ rule34Auth: { userId: '1', apiKey: 'k' } });
  await act(async () => {
    root = create(React.createElement(SourceSheet, { visible: true, onClose() {} }));
  });
  assert.equal(root.root.findByType('SourceCatalog').props.credentials.rule34, true);
});

test('choosing another source switches and closes; choosing active only closes', async () => {
  let closed = 0;
  const { SourceSheet } = loadSheet({ source: { id: 'a', name: 'A' } });
  await act(async () => {
    root = create(React.createElement(SourceSheet, { visible: true, onClose: () => { closed += 1; } }));
  });
  const catalog = root.root.findByType('SourceCatalog');
  await act(async () => {
    await catalog.props.onSelect({ id: 'b', name: 'B' });
  });
  assert.equal(closed, 1);
  await act(async () => {
    await catalog.props.onSelect({ id: 'a', name: 'A' });
  });
  assert.equal(closed, 2);
});

test('failed switch keeps the sheet open for retry', async () => {
  let closed = 0;
  const { SourceSheet, calls } = loadSheet({
    selectSource: async () => {
      throw new Error('offline');
    },
  });
  await act(async () => {
    root = create(React.createElement(SourceSheet, { visible: true, onClose: () => { closed += 1; } }));
  });
  await act(async () => {
    await root.root.findByType('SourceCatalog').props.onSelect({ id: 'b', name: 'B' });
  });
  assert.deepEqual(calls.selected, ['b']);
  assert.equal(closed, 0);
});

test('manage button leaves the sheet for Settings', async () => {
  let managed = 0;
  const { SourceSheet } = loadSheet();
  await act(async () => {
    root = create(
      React.createElement(SourceSheet, {
        visible: true,
        onClose() {},
        onManage: () => {
          managed += 1;
        },
      })
    );
  });
  await act(async () => {
    root.root.findByProps({ accessibilityLabel: 'Manage sources' }).props.onPress();
  });
  assert.equal(managed, 1);
});

test('Android overFullScreen SourceSheet omits non-functional drag handle', async () => {
  const { SourceSheet } = loadSheet({ os: 'android' });
  await act(async () => {
    root = create(React.createElement(SourceSheet, { visible: true, onClose() {} }));
  });
  assert.equal(root.root.findByType('Modal').props.presentationStyle, 'overFullScreen');
  const handles = root.root.findAllByType('View').filter((n) => n.props.style?.width === 40 && n.props.style?.height === 4);
  assert.equal(handles.length, 0);
});

test('SearchFilterModal uses a single Modal, English copy, no nested FlatList, and defers source/page commits until explicit confirm', async () => {
  const selectCalls = [];
  const appliedConfigs = [];
  const { createLoader } = require('./helpers/load-typescript.cjs');
  const animatedStub = {
    Value: class {
      constructor(v) { this.v = v; }
      setValue(v) { this.v = v; }
      interpolate() { return 1; }
    },
    View: 'AnimatedView',
    timing: () => ({ start: (cb) => cb?.() }),
  };
  const mocks = {
    react: React,
    'react-native': {
      Alert: { alert() {} },
      Animated: animatedStub,
      Platform: { OS: 'android' },
      StyleSheet: { create: (v) => v },
      ...Object.fromEntries(
        ['KeyboardAvoidingView', 'Modal', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'TouchableWithoutFeedback', 'View'].map((n) => [n, n])
      ),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
    'lucide-react-native': { X: 'X', Search: 'Search', ChevronRight: 'ChevronRight', Check: 'Check' },
    'expo-haptics': { selectionAsync() {}, impactAsync() {}, ImpactFeedbackStyle: {} },
    '../services/booruApi': { booruApi: { searchTags: async () => [] } },
    '../services/nhentai': { nhentaiTagQuery: (t) => t },
    '../services/hentaihavens': { hentaiHavenTagQuery: (t) => t },
    '../utils/leaderboardPeriods': { dayDateOptions: () => [], weekDateOptions: () => [], monthDateOptions: () => [], describeAnchor: () => 'Latest' },
    './SourceCatalog': {
      SourceCatalog: 'SourceCatalog',
      SourceMark: 'SourceMark',
    },
    '../context/SourceContext': {
      useSource: () => ({
        selectSource: async (s) => { selectCalls.push(s.id); },
      }),
    },
    './TagChip': { TagChip: 'TagChip' },
    '../theme/colors': { Colors: { dark: { textMuted: '#888' } } },
    '../types/booru': {
      DEFAULT_FILTER_CONFIG: {
        tags: [], rating: 'all', sortBy: 'default', timeRange: 'all',
        includeBlacklisted: false, autocompleteFromServer: true,
        jumpToPage: 1, cumstService: 'all', cumstMediaType: 'all',
      },
    },
  };
  const { SearchFilterModal } = createLoader(mocks)(path.resolve(__dirname, '../src/components/SearchFilterModal.tsx'));
  const danbooru = { id: 'danbooru', name: 'Danbooru', type: 'danbooru', baseUrl: 'https://danbooru.donmai.us' };
  const rule34 = { id: 'rule34', name: 'Rule34', type: 'gelbooru', baseUrl: 'https://api.rule34.xxx' };
  const filterConfig = {
    tags: [], rating: 'all', sortBy: 'default', timeRange: 'all',
    includeBlacklisted: false, autocompleteFromServer: true,
    jumpToPage: 3, cumstService: 'all', cumstMediaType: 'all',
  };
  await act(async () => {
    root = create(React.createElement(SearchFilterModal, {
      visible: true,
      filterConfig,
      activeSource: danbooru,
      onSelectSource: async (s) => { selectCalls.push(s.id); },
      onClose() {},
      onApply: (cfg) => { appliedConfigs.push(cfg); },
    }));
  });

  // Only one Modal rendered (no 8 nested modals), English copy only, no FlatList
  assert.equal(root.root.findAllByType('Modal').length, 1);
  assert.equal(root.root.findAllByType('KeyboardAvoidingView').length >= 1, true);
  const allTexts = root.root.findAllByType('Text').map((n) => String(n.props.children));
  assert.equal(allTexts.some((t) => /Hepsi|Sayfa|Derecelendirme/.test(t)), false);
  assert.equal(allTexts.includes('Page 3'), true);

  // Backdrop tap on Go to Page does NOT commit typed page
  const pageRow = root.root.findAllByType('TouchableOpacity').find((n) =>
    n.findAllByType('Text').some((t) => t.props.children === 'Jump to Page')
  );
  await act(async () => { pageRow.props.onPress(); });
  const pageInput = root.root.findAllByType('TextInput').find((n) =>
    String(n.props.placeholder || '').startsWith('Page number')
  );
  await act(async () => { pageInput.props.onChangeText('9'); });
  const backdrop = root.root.findByProps({ accessibilityLabel: 'Dismiss picker' });
  await act(async () => { backdrop.props.onPress(); });

  // Selecting a source in the inline catalog does NOT mutate global selectSource before Apply
  const serverRow = root.root.findAllByType('TouchableOpacity').find((n) =>
    n.findAllByType('Text').some((t) => t.props.children === 'Danbooru')
  );
  await act(async () => { serverRow.props.onPress(); });
  await act(async () => { await root.root.findByType('SourceCatalog').props.onSelect(rule34); });
  assert.deepEqual(selectCalls, []);

  // Tapping Apply commits both the selected source and original jumpToPage (3, not cancelled 9)
  const applyBtn = root.root.findByProps({ accessibilityLabel: 'Apply filters' });
  await act(async () => { await applyBtn.props.onPress(); });
  assert.deepEqual(selectCalls, ['rule34']);
  assert.equal(appliedConfigs.length, 1);
  assert.equal(appliedConfigs[0].jumpToPage, 3);
});
