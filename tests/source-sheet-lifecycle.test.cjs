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

function loadSheet({ source = { id: 'a', name: 'A' }, selectSource = async () => {}, rule34Auth = { userId: '', apiKey: '' } } = {}) {
  const calls = { selected: [], closed: 0, managed: 0, authReads: 0 };
  const mocks = {
    react: React,
    'react-native': {
      Platform: { OS: 'ios' },
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
