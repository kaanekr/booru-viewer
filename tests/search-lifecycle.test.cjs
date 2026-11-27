const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { createLoader } = require('./helpers/load-typescript.cjs');
const { AVAILABLE_SOURCES } = createLoader()(path.resolve(__dirname, '../src/services/sources.ts'));
global.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(async () => { if (root) await act(() => root.unmount()); root = undefined; });
const post = (id) => ({ id, sourceId: 'a', previewUrl: `https://cdn.test/${id}.jpg`, tags: {}, aspectRatio: 1 });

function setup(sourceOverride = {}, apiOverrides = {}) {
  const scrollHeader = require('./helpers/scroll-away-header.cjs').loadScrollAwayHeader();
  const source = { id: 'a', type: 'danbooru', name: 'A', ...sourceOverride };
  const requests = [];
  const detailNavigations = [];
  const viewport = {};
  const navigation = { setParams() {}, navigate() {} };
  const load = createLoader({
    react: React,
    'react-native': {
      Platform: { OS: 'ios' },
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      StyleSheet: { create: (value) => value }, Keyboard: { dismiss() {} },
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((name) => [name, name])),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0 }) },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    'expo-image': { Image: { prefetch: async () => {} } },
    '../services/booruApi': { booruApi: {
      fetchPostsWithFilter: (filter, page, _limit, source) => new Promise((resolve, reject) => requests.push({ filter, page, source, resolve, reject })),
      fetchRedGifsNiches: async () => [],
      fetchSourceTags: async () => [],
      ...apiOverrides,
    } },
    '../services/nhentai': {}, '../services/hentaihavens': {},
    '@react-navigation/native': { useNavigation: () => navigation, useIsFocused: () => true },
    '../services/storage': { StorageService: {
      getFavorites: async () => [], getSearchHistory: async () => [], getFavoriteTags: async () => [], addSearchHistory: async () => {},
    } },
    '../components/PostCard': { PostCard: 'PostCard' }, '../components/TagChip': { TagChip: 'TagChip' },
    '../components/SearchFilterModal': { SearchFilterModal: 'SearchFilterModal' },
    '../components/SourceSheet': { SourceSheet: 'SourceSheet' },
    '../navigation/rootNavigation': { pushViewer() {}, pushSearchDetail: (...args) => detailNavigations.push(args) },
    '../utils/media': { getMediaUrl: (url) => url, getMediaHeaders: () => ({}), isVideoPost: () => false, isImageMediaUrl: (url) => !/\.(mp4|webm|mov|m4v|m3u8|mpd|zip)(?:\?|$)/i.test(String(url || '')) },
    '../utils/gridVisibility': {
      useVisibleIds: () => [new Set(), (_layouts, offset, height) => { viewport.visible = { offset, height }; }],
      useMountedIds: () => [null, () => {}],
      useFocusedCardIds: () => [new Set(), (_layouts, offset, height, playable) => { viewport.focused = { offset, height, playable }; }],
    },
    '../context/MediaPlaybackContext': { useMediaPlaybackAllowed: () => true },
    '../context/SourceContext': { useSource: () => ({ activeSource: source }) },
    '../utils/scrollAwayHeader': scrollHeader.hook,
    '../components/ScrollAwayHeader': scrollHeader.component,
    '../utils/imagePrefetch': { prefetchGridImages() {} },
    '../utils/listCache': {
      buildListCacheKey: () => 'search-key',
      SEARCH_LIST_TTL_MS: 1800000,
      getListCache: async () => null,
      setListCache: async () => {},
    },
  }, { console: { ...console, warn() {} } });
  return {
    Screen: load(path.resolve(__dirname, '../src/screens/SearchScreen.tsx')).SearchScreen,
    defaults: load(path.resolve(__dirname, '../src/types/booru.ts')).DEFAULT_FILTER_CONFIG,
    requests, detailNavigations, viewport, navigation, headerAnimations: scrollHeader.animations,
  };
}
const apply = async (defaults, tag) => act(async () => {
  root.root.findByType('SearchFilterModal').props.onApply({ ...defaults, tags: [tag] });
});
const bottom = () => root.root.findAllByType('ScrollView').find((node) => node.props.onScroll).props.onScroll({
  nativeEvent: { contentOffset: { y: 2000 }, layoutMeasurement: { height: 844 }, contentSize: { height: 2500 } },
});

test('quick filter before the first search actually fetches instead of only lighting the chip', async () => {
  const { Screen, requests } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await act(async () => root.root.findByProps({ accessibilityLabel: 'Weekly Top' }).props.onPress());
  assert.equal(requests.length, 1);
  assert.equal(requests[0].filter.sortBy, 'score');
  assert.equal(requests[0].filter.timeRange, '1w');
  assert.equal(requests[0].page, 1);
});

test('video weekly search chips depend on a keyword and never offer Safe or Points', async () => {
  const { Screen, requests } = setup({ id: 'xvideos', type: 'xvideos' });
  await act(async () => { root = create(React.createElement(Screen)); });
  assert.equal(root.root.findAllByProps({ accessibilityLabel: 'Weekly Top' }).length, 0);
  assert.equal(root.root.findAllByProps({ accessibilityLabel: 'Safe' }).length, 0);
  assert.equal(root.root.findAllByProps({ accessibilityLabel: '50+ Points' }).length, 0);
  const input = root.root.findAllByType('TextInput')[0];
  await act(async () => input.props.onChangeText('cosplay'));
  await act(async () => root.root.findByProps({ accessibilityLabel: 'Weekly Top' }).props.onPress());
  assert.equal(requests.length, 1);
  assert.deepEqual(Array.from(requests[0].filter.tags), ['cosplay']);
  assert.equal(requests[0].filter.timeRange, '1w');
});

test('Explore displays source tags and applies the native query when a tag is tapped', async () => {
  const { Screen, requests } = setup({ id: 'nhentai', type: 'nhentai' }, {
    fetchSourceTags: async () => [{ name: 'Lunar Press', query: 'group:"Lunar Press"', category: 'artist', postCount: 5 }],
  });
  await act(async () => { root = create(React.createElement(Screen)); });
  const chips = root.root.findAllByType('TagChip');
  assert.deepEqual(chips.map((chip) => chip.props.name), ['Lunar Press']);
  await act(async () => chips[0].props.onPress());
  assert.deepEqual(Array.from(requests[0].filter.tags), ['group:"lunar press"']);
});

test('autocomplete replaces a partially quoted phrase, preserving its qualifier and negation', async () => {
  const completed = { name: 'Lunar Press', query: 'group:"Lunar Press"', category: 'artist', postCount: 5 };
  const calls = [];
  const { Screen, requests } = setup({ id: 'nhentai', type: 'nhentai' }, {
    searchTags: async (query, limit, source, type) => {
      calls.push({ query, type, source: source.id });
      return type === 'language'
        ? [{ name: 'English', query: 'language:"english"', category: 'meta', postCount: 12 }]
        : [completed];
    },
  });
  await act(async () => { root = create(React.createElement(Screen)); });
  const input = root.root.findByType('TextInput');
  await act(async () => {
    input.props.onFocus();
    input.props.onChangeText('language:english -group:"lunar pr');
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  assert.deepEqual(calls, [
    { query: 'lunar pr', type: 'group', source: 'nhentai' },
    { query: 'english', type: 'language', source: 'nhentai' },
  ]);
  const list = root.root.findAllByType('FlatList').find((node) => node.props.data?.[0] === completed);
  const suggestion = list.props.renderItem({ item: completed });
  await act(async () => suggestion.props.onPress());
  assert.deepEqual(Array.from(requests[0].filter.tags), ['language:english', '-group:"lunar press"']);

  const selected = root.root.findAllByType('TagChip').filter((chip) => chip.props.onRemove);
  assert.deepEqual(selected.map((chip) => chip.props.name), ['language:english', '-group:"lunar press"']);
  assert.equal(selected[1].props.category, 'artist');
  await act(async () => selected[1].props.onRemove());
  assert.equal(root.root.findAllByType('TagChip').find((chip) => chip.props.onRemove).props.name, 'language:english');
  assert.deepEqual(Array.from(requests[1].filter.tags), ['language:english']);
});

test('recognized text stays in the search field as a tag and can be removed without submitting', async () => {
  const { Screen, requests } = setup({}, {
    searchTags: async (query) => query === 'blue_sky'
      ? [{ name: 'blue_sky', category: 'general', postCount: 42 }]
      : [],
  });
  await act(async () => { root = create(React.createElement(Screen)); });
  const input = root.root.findByType('TextInput');
  const queryChips = () => root.root.findAllByType('TagChip').filter((chip) => chip.props.onRemove);
  await act(async () => {
    input.props.onFocus();
    input.props.onChangeText('blue_sky');
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  assert.equal(input.props.value, 'blue_sky');
  assert.ok(root.root.findByProps({ testID: 'search-query-active-tag' }).findByType('TextInput'));
  assert.equal(queryChips().length, 0);

  await act(async () => input.props.onChangeText('blue_sky "typing a phrase"'));
  const editor = root.root.findAllByType('ScrollView').find((node) => node.findAllByType('TextInput').length);
  const chip = editor.findByType('TagChip');
  assert.equal(chip.props.name, 'blue_sky');
  assert.equal(chip.props.inline, true);
  assert.equal(input.props.value, '"typing a phrase"');
  await act(async () => queryChips()[0].props.onRemove());
  assert.equal(input.props.value, '"typing a phrase"');
  assert.equal(queryChips().length, 0);
  assert.equal(requests.length, 0);
});

const tagFixtures = {
  gelbooru: ['landscape'],
  yandere: ['landscape'],
  danbooru: ['landscape'],
  realbooru: ['cosplay'],
  rule34: ['landscape'],
  cumst: ['costume'],
  redgifs: ['retro_costume'],
  xvideos: ['tag:"retro costume"', 'Retro Costume'],
  xhamster: ['tag:retro_costume', 'Retro Costume', '"retro costume"'],
  pornhub: ['tag:"retro costume"', 'retro_costume'],
  sexcom: [],
  hentaihaven: ['genre:comedy', 'Comedy', 'tag:comedy'],
  nhentai: ['-group:"lunar press"', 'Lunar Press', 'group:"lunar press"'],
};

for (const source of AVAILABLE_SOURCES) {
  test(`${source.id} only marks source-confirmed inline tags`, async () => {
    const [token, name = token, qualified] = tagFixtures[source.id];
    const lookupRequests = [];
    const { Screen, requests } = setup(source, {
      searchTags: async (text, _limit, requestedSource) => {
        lookupRequests.push({ text, source: requestedSource.id });
        if (text === 'unknown_keyword') {
          return source.id === 'cumst'
            ? [{ name: text, category: 'artist', isTag: false, postCount: 20 }]
            : [{ name: 'unknown_keyword_extended', query: 'unknown_keyword_extended', category: 'general', postCount: 20 }];
        }
        if (text === 'fake_filter' || !token) return [];
        return [{ name, query: qualified, category: 'general', postCount: 5 }];
      },
    });
    await act(async () => { root = create(React.createElement(Screen)); });
    const input = root.root.findByType('TextInput');
    const inlineTags = () => root.root.findAllByType('TagChip').filter((chip) => chip.props.inline);
    const query = [token, 'unknown_keyword', 'tag:fake_filter', 'sort:score'].filter(Boolean).join(' ');
    await act(async () => {
      input.props.onFocus();
      input.props.onChangeText(query);
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    assert.deepEqual(inlineTags().map((chip) => chip.props.name), token ? [token] : []);
    assert.match(input.props.value, /unknown_keyword tag:fake_filter sort:score$/);
    assert.ok(lookupRequests.every((request) => request.source === source.id));
    assert.equal(lookupRequests.some((request) => request.text === 'sort:score'), false);
    await act(async () => input.props.onSubmitEditing());
    assert.deepEqual(Array.from(requests[0].filter.tags), [token, 'unknown_keyword', 'tag:fake_filter', 'sort:score'].filter(Boolean));
    assert.deepEqual(inlineTags().map((chip) => chip.props.name), token ? [token] : []);
  });
}

test('switching sources discards a pending exact tag lookup for the old source', async () => {
  const oldLookups = [];
  const { Screen } = setup({}, {
    searchTags: (_text, _limit, source) => source.id === 'first'
      ? new Promise((resolve) => { oldLookups.push(resolve); })
      : Promise.resolve([]),
  });
  const first = AVAILABLE_SOURCES.find((source) => source.id === 'gelbooru');
  const second = AVAILABLE_SOURCES.find((source) => source.id === 'danbooru');
  await act(async () => { root = create(React.createElement(Screen, { activeSource: { ...first, id: 'first' } })); });
  const input = root.root.findByType('TextInput');
  await act(async () => input.props.onChangeText('landscape elsewhere'));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  assert.equal(oldLookups.length, 2);
  await act(async () => root.update(React.createElement(Screen, { activeSource: second })));
  await act(async () => {
    for (const resolve of oldLookups) resolve([{ name: 'landscape', category: 'general', postCount: 10 }]);
  });
  assert.equal(input.props.value, 'landscape elsewhere');
  assert.equal(root.root.findAllByType('TagChip').some((chip) => chip.props.inline), false);
});

const creatorFixture = { id: '17', service: 'patreon', name: 'studio_name', displayName: 'Studio Name', postCount: 8 };

test('Cum.st opens a creator profile for a full-name suggestion or an exact typed handle', async () => {
  const lookupTerms = [];
  const source = AVAILABLE_SOURCES.find((entry) => entry.id === 'cumst');
  const suggestion = { name: creatorFixture.name, category: 'artist', isTag: false, cumstCreator: creatorFixture };
  const { Screen, requests, detailNavigations } = setup(source, {
    searchTags: async (term, _limit, _source, type) => {
      lookupTerms.push([term, type]);
      return type === 'creator' && term === 'Studio Na' ? [suggestion] : [];
    },
    findCumStCreator: async (_source, term) => term === '@studio_name' ? creatorFixture : undefined,
  });
  await act(async () => { root = create(React.createElement(Screen)); });
  const input = root.root.findByType('TextInput');
  await act(async () => input.props.onChangeText('Studio Na'));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  assert.ok(lookupTerms.some(([term, type]) => term === 'Studio Na' && type === 'creator'));
  const dropdown = root.root.findAllByType('FlatList').find((node) => node.props.data?.[0] === suggestion);
  const row = dropdown.props.renderItem({ item: suggestion });
  assert.match(row.props.accessibilityLabel, /Open creator Studio Name/);
  await act(async () => row.props.onPress());
  assert.equal(detailNavigations[0][1].cumstCreator.id, '17');
  assert.equal(detailNavigations[0][2].id, 'cumst');
  assert.equal(requests.length, 0);

  await act(async () => input.props.onChangeText('@studio_name'));
  await act(async () => input.props.onSubmitEditing());
  assert.equal(detailNavigations[1][1].cumstCreator.id, '17');
  assert.equal(requests.length, 0);

  await act(async () => input.props.onChangeText('ordinary keyword'));
  await act(async () => input.props.onSubmitEditing());
  assert.deepEqual(Array.from(requests[0].filter.tags), ['ordinary', 'keyword']);
  assert.equal(detailNavigations.length, 2);
});

test('Cum.st profile header and searches keep the same creator scope', async () => {
  const source = AVAILABLE_SOURCES.find((entry) => entry.id === 'cumst');
  const { Screen, defaults, requests } = setup(source);
  await act(async () => {
    root = create(React.createElement(Screen, {
      initialFilter: { ...defaults, cumstCreator: creatorFixture },
      onBackPress() {},
    }));
  });
  assert.equal(root.root.findByProps({ accessibilityRole: 'header' }).props.children, 'Studio Name');
  assert.equal(requests[0].filter.cumstCreator.id, '17');
  const input = root.root.findByProps({ accessibilityLabel: 'Search creator posts' });
  await act(async () => input.props.onChangeText('preview'));
  await act(async () => input.props.onSubmitEditing());
  assert.equal(requests[1].filter.cumstCreator.id, '17');
  assert.deepEqual(Array.from(requests[1].filter.tags), ['preview']);
});

test('stale search rejection/finally cannot replace a newer search or clear its loader', async () => {
  const { Screen, defaults, requests } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await apply(defaults, 'first');
  await apply(defaults, 'second');
  assert.equal(requests.length, 2);
  await act(async () => { requests[0].reject(new Error('old failure')); });
  assert.equal(root.root.findAllByType('ActivityIndicator').length, 1);
  await act(async () => { requests[1].resolve([post('new')]); });
  assert.deepEqual(root.root.findAllByType('PostCard').map((card) => card.props.post.id), ['new']);
});

test('search pagination is single flight and stops after a duplicate page', async () => {
  const { Screen, defaults, requests } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await apply(defaults, 'sky');
  await act(async () => { requests[0].resolve([post('first')]); });
  await act(() => { bottom(); bottom(); bottom(); });
  assert.equal(requests.length, 2);
  assert.equal(requests[1].page, 2);
  await act(async () => { requests[1].resolve([post('first')]); });
  await act(() => { bottom(); bottom(); });
  assert.equal(requests.length, 2);
});

test('failed search page retries the same page; old pagination cannot clear a new search', async () => {
  const { Screen, defaults, requests } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await apply(defaults, 'first');
  await act(async () => { requests[0].resolve([post('first')]); });
  await act(() => bottom());
  await act(async () => { requests[1].reject(new Error('page failed')); });
  await act(() => bottom());
  assert.equal(requests[2].page, 2);
  await apply(defaults, 'new');
  await act(async () => { requests[2].reject(new Error('old page failed')); });
  assert.equal(root.root.findAllByType('ActivityIndicator').length, 1);
  await act(async () => { requests[3].resolve([post('new')]); });
  assert.deepEqual(root.root.findAllByType('PostCard').map((card) => card.props.post.id), ['new']);
});

test('search preview focus subtracts the measured filter banner and uses actual viewport height', async () => {
  const { Screen, defaults, requests, viewport } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await apply(defaults, 'sky');
  await act(async () => requests[0].resolve([{ ...post('clip'), sampleUrl: 'https://cdn.test/sample.mp4' }]));
  const scroll = () => root.root.findAllByType('ScrollView').find((node) => node.props.onScroll);
  await act(async () => scroll().props.onLayout({ nativeEvent: { layout: { height: 500 } } }));
  await act(async () => root.root.findAllByType('View').filter((node) => node.props.onLayout).at(-1).props.onLayout({ nativeEvent: { layout: { y: 100 } } }));
  assert.deepEqual(viewport.visible, { offset: -100, height: 500 });
  assert.deepEqual([...viewport.focused.playable], ['clip']);
  await act(async () => scroll().props.onScroll({
    nativeEvent: { contentOffset: { y: 250 }, layoutMeasurement: { height: 480 }, contentSize: { height: 5000 } },
  }));
  assert.deepEqual(viewport.visible, { offset: 150, height: 480 });
  assert.equal(viewport.focused.offset, 150);
});

test('search header and quick chip open the same in-place source sheet', async () => {
  const { Screen, navigation } = setup();
  const navigated = [];
  navigation.navigate = (...args) => navigated.push(args);
  await act(async () => { root = create(React.createElement(Screen)); });
  const triggers = root.root.findAllByType('TouchableOpacity').filter((node) =>
    typeof node.props.accessibilityLabel === 'string' && node.props.accessibilityLabel.includes('Change source')
  );
  assert.equal(triggers.length, 2);
  assert.equal(root.root.findByType('SourceSheet').props.visible, false);
  await act(async () => { triggers[0].props.onPress(); });
  assert.equal(root.root.findByType('SourceSheet').props.visible, true);
  await act(async () => { root.root.findByType('SourceSheet').props.onClose(); });
  assert.equal(root.root.findByType('SourceSheet').props.visible, false);
  await act(async () => { triggers[1].props.onPress(); });
  await act(async () => { root.root.findByType('SourceSheet').props.onManage(); });
  assert.equal(navigated[0][0], 'Settings');
  assert.equal(navigated[0][1].section, 'sources');
});

test('results header collapses, reverses, and is forced visible when the search input receives focus', async () => {
  const { Screen, defaults, requests, viewport } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await apply(defaults, 'landscape');
  await act(async () => requests[0].resolve([post('one')]));
  await act(async () => root.root.findByProps({ testID: 'scroll-away-header' }).props.onLayout({ nativeEvent: { layout: { height: 100 } } }));
  const scroll = () => root.root.findAllByType('ScrollView').find((n) => n.props.onScroll);
  const translateY = () => root.root.findByProps({ testID: 'scroll-away-header' }).props.style.find((s) => s && s.transform)?.transform?.[0]?.translateY?.value;
  assert.equal(scroll().props.contentContainerStyle.at(-1).paddingTop, 112);
  const move = (y) => act(async () => scroll().props.onScroll({ nativeEvent: {
    contentOffset: { y }, layoutMeasurement: { height: 500 }, contentSize: { height: 5000 },
  } }));
  await move(0); await move(250);
  assert.equal(translateY(), -100);
  await move(150);
  assert.equal(translateY(), 0);
  assert.equal(viewport.visible.height, 400);
  await move(260);
  await act(async () => root.root.findByType('TextInput').props.onFocus());
  assert.equal(translateY(), 0);
  await move(400);
  assert.equal(translateY(), 0);
});

test('SearchScreen keeps PostCard onPress reference stable across pagination', async () => {
  const { Screen, defaults, requests } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  await apply(defaults, 'sky');
  await act(async () => requests[0].resolve([post('s1')]));
  const firstOnPress = root.root.findByType('PostCard').props.onPress;
  await act(() => bottom());
  await act(async () => requests[1].resolve([post('s2')]));
  const cards = root.root.findAllByType('PostCard');
  assert.equal(cards.length, 2);
  assert.equal(cards[0].props.onPress, firstOnPress);
  assert.equal(cards[1].props.onPress, firstOnPress);
});

test('SearchDetail bottom padding includes safe-area bottom inset and suggestions offset follows searchBar layout', async () => {
  const scrollHeader = require('./helpers/scroll-away-header.cjs').loadScrollAwayHeader();
  const load = createLoader({
    react: React,
    'react-native': {
      Platform: { OS: 'ios' },
      Dimensions: { get: () => ({ width: 390, height: 844 }) },
      useWindowDimensions: () => ({ width: 390, height: 844 }),
      StyleSheet: { create: (value) => value }, Keyboard: { dismiss() {} },
      ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'ScrollView', 'Text', 'TextInput', 'TouchableOpacity', 'View'].map((name) => [name, name])),
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) },
    'lucide-react-native': new Proxy({}, { get: (_, name) => String(name) }),
    'expo-haptics': { impactAsync() {}, selectionAsync() {}, ImpactFeedbackStyle: {} },
    'expo-image': { Image: { prefetch: async () => {} } },
    '../services/booruApi': { booruApi: {
      fetchPostsWithFilter: async () => [post('one')],
      fetchRedGifsNiches: async () => [],
      searchTags: async () => [{ name: 'sky', postCount: 10, category: 'general' }],
    } },
    '../services/nhentai': {}, '../services/hentaihavens': {},
    '@react-navigation/native': { useNavigation: () => ({ setParams() {}, navigate() {} }), useIsFocused: () => true },
    '../services/storage': { StorageService: {
      getFavorites: async () => [], getSearchHistory: async () => [], getFavoriteTags: async () => [], addSearchHistory: async () => {},
    } },
    '../components/PostCard': { PostCard: 'PostCard' }, '../components/TagChip': { TagChip: 'TagChip' },
    '../components/SearchFilterModal': { SearchFilterModal: 'SearchFilterModal' },
    '../components/SourceSheet': { SourceSheet: 'SourceSheet' },
    '../navigation/rootNavigation': { pushViewer() {} },
    '../utils/media': { getMediaUrl: (url) => url, getMediaHeaders: () => ({}), isVideoPost: () => false, isImageMediaUrl: () => true },
    '../utils/gridVisibility': {
      useVisibleIds: () => [new Set(), () => {}],
      useMountedIds: () => [null, () => {}],
      useFocusedCardIds: () => [new Set(), () => {}],
    },
    '../context/MediaPlaybackContext': { useMediaPlaybackAllowed: () => true },
    '../context/SourceContext': { useSource: () => ({ activeSource: { id: 'a', type: 'danbooru', name: 'A' } }) },
    '../utils/scrollAwayHeader': scrollHeader.hook,
    '../components/ScrollAwayHeader': scrollHeader.component,
    '../utils/imagePrefetch': { prefetchGridImages() {} },
    '../utils/listCache': {
      buildListCacheKey: () => 'search-key',
      SEARCH_LIST_TTL_MS: 1800000,
      getListCache: async () => null,
      setListCache: async () => {},
    },
  }, { console: { ...console, warn() {} } });
  const Screen = load(path.resolve(__dirname, '../src/screens/SearchScreen.tsx')).SearchScreen;
  const defaults = load(path.resolve(__dirname, '../src/types/booru.ts')).DEFAULT_FILTER_CONFIG;
  await act(async () => { root = create(React.createElement(Screen, { onBackPress: () => {} })); });
  await act(async () => { root.root.findByType('SearchFilterModal').props.onApply({ ...defaults, tags: ['sky'] }); });
  const resultsScroll = root.root.findAllByType('ScrollView').find((n) => n.props.onScroll);
  const bottomStyle = resultsScroll.props.contentContainerStyle.filter((s) => s && typeof s.paddingBottom === 'number').at(-1);
  assert.equal(bottomStyle.paddingBottom, 64);
});

test('inline search query aligns tag chips and normal search input on the same 28px vertical centerline', async () => {
  const { Screen } = setup();
  await act(async () => { root = create(React.createElement(Screen)); });
  const inlineScroll = root.root.findAllByType('ScrollView').find((node) => node.findAllByType('TextInput').length);
  assert.equal(inlineScroll.props.style.height, '100%');
  assert.equal(inlineScroll.props.contentContainerStyle.alignItems, 'center');
  assert.equal(inlineScroll.props.contentContainerStyle.flexDirection, 'row');
  const input = inlineScroll.findByType('TextInput');
  const inputStyles = Object.assign({}, ...input.props.style.filter(Boolean));
  assert.equal(inputStyles.lineHeight, undefined);
  assert.equal(inputStyles.textAlignVertical, 'center');
  const editorView = inlineScroll.findAllByType('View').find((node) => node.findAllByType('TextInput').length);
  const editorStyles = Object.assign({}, ...editorView.props.style.filter(Boolean));
  assert.equal(editorStyles.height, 28);
});
