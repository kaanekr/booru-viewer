const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./helpers/load-typescript.cjs');

const FAVORITES = '@booru_favorites_v2';
const RECENT = '@booru_recent_views_v2';

test('Rule34 credentials are separate from Gelbooru, trimmed and removable', async () => {
  const { service } = setup();
  await service.setGelbooruAuth({ userId: '7', apiKey: 'gelbooru-test' });
  await service.setRule34Auth({ userId: ' 42 ', apiKey: ' rule34-test ' });
  assert.equal((await service.getRule34Auth()).userId, '42');
  assert.equal((await service.getRule34Auth()).apiKey, 'rule34-test');
  assert.equal((await service.getGelbooruAuth()).apiKey, 'gelbooru-test');
  await service.setRule34Auth({ userId: '', apiKey: '' });
  assert.equal((await service.getRule34Auth()).apiKey, '');
  assert.equal((await service.getGelbooruAuth()).apiKey, 'gelbooru-test');
});

test('Rule34 credential reads tolerate corrupt shapes, but failed saves reject', async () => {
  const { service, failNextWrite } = setup({ '@booru_rule34_auth_v1': { userId: 42, apiKey: [] } });
  assert.equal((await service.getRule34Auth()).userId, '');
  assert.equal((await service.getRule34Auth()).apiKey, '');
  failNextWrite();
  await assert.rejects(service.setRule34Auth({ userId: '42', apiKey: 'test' }), /disk full/);
});

test('settings can report failed Gelbooru and relay saves without replacing stored configuration', async () => {
  const { service, failNextWrite } = setup();
  await service.setGelbooruAuth({ userId: '7', apiKey: 'original-test-key' });
  await service.setProxyConfig({ enabled: true, workerUrl: 'https://original.test' });
  failNextWrite();
  await assert.rejects(service.setGelbooruAuth({ userId: '8', apiKey: 'new-test-key' }), /disk full/);
  failNextWrite();
  await assert.rejects(service.setProxyConfig({ enabled: false, workerUrl: '' }), /disk full/);
  assert.equal((await service.getGelbooruAuth()).apiKey, 'original-test-key');
  assert.equal((await service.getProxyConfig()).workerUrl, 'https://original.test');
});

const post = (sourceId, id) => ({ sourceId, id, originalUrl: `https://${sourceId}.test/${id}.jpg` });
function setup(initial = {}) {
  const data = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  let failWrite = false;
  let failRead = false;
  const storage = {
    async getItem(key) {
      const value = data.get(key) ?? null;
      await new Promise(setImmediate);
      if (failRead) throw new Error('read failed');
      return value;
    },
    async setItem(key, value) {
      await new Promise(setImmediate);
      if (failWrite) { failWrite = false; throw new Error('disk full'); }
      data.set(key, value);
    },
    async removeItem(key) { await new Promise(setImmediate); data.delete(key); },
  };
  const load = createLoader({
    '@react-native-async-storage/async-storage': storage,
    './sources': { DEFAULT_SOURCE: { id: 'a' } },
    'expo-file-system': {}, 'expo-document-picker': {}, 'expo-sharing': {},
    '../utils/media': { normalizeBooruMediaUrl: (url) => url || '' },
  }, { console: { ...console, warn() {} } });
  return {
    load,
    service: load(path.resolve(__dirname, '../src/services/storage.ts')).StorageService,
    stored: (key) => JSON.parse(data.get(key) || '[]'),
    failNextWrite: () => { failWrite = true; },
    setReadFailure: (value) => { failRead = value; },
  };
}

test('same remote ID from two sources remains two independent favorites', async () => {
  const { service } = setup();
  const a = post('a', '42'); const b = post('b', '42');
  assert.equal(await service.toggleFavorite(a), true);
  assert.equal(await service.isFavorite(b), false);
  assert.equal(await service.toggleFavorite(b), true);
  assert.equal((await service.getFavorites()).length, 2);
  assert.equal(await service.toggleFavorite(a), false);
  assert.equal(await service.isFavorite(a), false);
  assert.equal(await service.isFavorite(b), true);
});

test('parallel favorite writes and reads retain all updates', async () => {
  const { service } = setup();
  const writes = Array.from({ length: 12 }, (_, i) => service.toggleFavorite(post('a', String(i))));
  const read = service.getFavorites();
  await Promise.all(writes);
  assert.equal((await read).length, 12);
  assert.equal((await service.getFavorites()).length, 12);
});

test('write errors are not reported as successful unfavorites and do not poison the queue', async () => {
  const { service, failNextWrite } = setup();
  failNextWrite();
  await assert.rejects(service.toggleFavorite(post('a', '1')), /disk full/);
  await service.toggleFavorite(post('a', '2'));
  assert.deepEqual(Array.from(await service.getFavorites(), (p) => p.id), ['2']);
});

test('failed reads cannot overwrite existing favorites with an empty list', async () => {
  const { service, stored, setReadFailure } = setup({ [FAVORITES]: [post('a', '1')] });
  setReadFailure(true);
  await assert.rejects(service.toggleFavorite(post('a', '2')), /read failed/);
  assert.equal(stored(FAVORITES).length, 1);
});

test('legacy prefixed numeric booru IDs match live IDs without rewriting stored records', async () => {
  const legacy = post('danbooru', 'danbooru_42');
  const { service } = setup({ [FAVORITES]: [legacy] });
  assert.equal(await service.isFavorite(post('danbooru', '42')), true);
  assert.equal((await service.getFavorites())[0].id, 'danbooru_42');
  assert.equal(await service.toggleFavorite(post('danbooru', '42')), false);
});

test('parallel recent views keep source-qualified IDs and newest-first order', async () => {
  const { service } = setup();
  await Promise.all([service.addRecentView(post('a', '42')), service.addRecentView(post('b', '42'))]);
  assert.deepEqual(Array.from(await service.getRecentViews(), (p) => p.sourceId), ['b', 'a']);
});

test('recent cache changes only after a successful disk write', async () => {
  const { service, failNextWrite } = setup({ [RECENT]: [post('a', '1')] });
  await service.getRecentViews();
  failNextWrite();
  await service.addRecentView(post('a', '2'));
  assert.deepEqual(Array.from(await service.getRecentViews(), (p) => p.id), ['1']);
});

test('recent replacement keeps the newest 500, not the oldest 500', async () => {
  const { service } = setup();
  await service.saveAllRecentViews(Array.from({ length: 510 }, (_, i) => post('a', String(i))));
  const recent = await service.getRecentViews();
  assert.equal(recent.length, 500);
  assert.equal(recent[0].id, '0');
  assert.equal(recent[499].id, '499');
});

test('history, tag and episode read-modify-writes are serialized per key', async () => {
  const { service } = setup();
  await Promise.all([
    service.addSearchHistory('first'), service.addSearchHistory('second'),
    service.addFavoriteTag('first'), service.addFavoriteTag('second'),
    service.addBlacklistedTag('first'), service.addBlacklistedTag('second'),
    service.setLastWatchedEpisode('a', 1), service.setLastWatchedEpisode('b', 2),
  ]);
  assert.equal((await service.getSearchHistory()).length, 2);
  assert.equal((await service.getFavoriteTags()).length, 2);
  assert.equal((await service.getBlacklistedTags()).length, 2);
  assert.equal(await service.getLastWatchedEpisode('a'), 1);
  assert.equal(await service.getLastWatchedEpisode('b'), 2);
});

test('backup import deduplicates within each source, not across sources', async () => {
  const { service, load } = setup({ [FAVORITES]: [post('a', '42')] });
  const { BackupService } = load(path.resolve(__dirname, '../src/services/backupService.ts'));
  const result = await BackupService.importBackupData({ favorites: [post('b', '42'), post('b', '42'), post('a', '42')] });
  assert.equal(result.favoritesImported, 1);
  assert.equal(result.totalFavorites, 2);
  assert.deepEqual(Array.from(await service.getFavorites(), (p) => p.sourceId).sort(), ['a', 'b']);
  assert.equal((await service.getRecentViews()).length, 2);
});

test('backup import and concurrent UI toggle do not erase one another', async () => {
  const { service, load } = setup();
  const { BackupService } = load(path.resolve(__dirname, '../src/services/backupService.ts'));
  await Promise.all([
    BackupService.importBackupData({ favorites: [post('a', '1')], favoriteTags: ['sky'] }),
    service.toggleFavorite(post('b', '2')), service.addFavoriteTag('landscape'),
  ]);
  assert.equal((await service.getFavorites()).length, 2);
  assert.deepEqual(Array.from(await service.getFavoriteTags()).sort(), ['landscape', 'sky']);
});

test('backup repair does not overwrite a concurrent favorite toggle', async () => {
  const { service, load } = setup({ [FAVORITES]: [post('a', '1')] });
  const { BackupService } = load(path.resolve(__dirname, '../src/services/backupService.ts'));
  await Promise.all([BackupService.repairAndNormalizeStoredFavorites(), service.toggleFavorite(post('b', '2'))]);
  assert.equal((await service.getFavorites()).length, 2);
});

test('post keys distinguish delimiter-containing IDs and do not strip nonnumeric prefixes', () => {
  const { load } = setup();
  const { getPostKey } = load(path.resolve(__dirname, '../src/utils/postIdentity.ts'));
  assert.notEqual(getPostKey(post('a:b', 'c')), getPostKey(post('a', 'b:c')));
  assert.notEqual(getPostKey(post('danbooru', 'danbooru_custom')), getPostKey(post('danbooru', 'custom')));
});

test('backup normalization preserves an independent RedGifs poster fallback', () => {
  const { load } = setup();
  const { BackupService } = load(path.resolve(__dirname, '../src/services/backupService.ts'));
  const original = { ...post('redgifs', 'rg_clip'), previewFallbackUrl: 'https://cdn.test/poster.jpg' };
  const parsed = BackupService.parseAnimeBoxesBackup({ favorites: [original] });
  assert.equal(parsed.posts[0].previewFallbackUrl, original.previewFallbackUrl);
});

test('backup normalization retains clip and frame preview metadata', () => {
  const { load } = setup();
  const { BackupService } = load(path.resolve(__dirname, '../src/services/backupService.ts'));
  const original = {
    ...post('pornhub', 'ph_clip'), previewVideoUrl: 'https://cdn.test/clip.mp4',
    previewThumbUrl: 'https://cdn.test/last.jpg', previewThumbs: ['https://cdn.test/1.jpg', null, 'https://cdn.test/2.jpg'],
  };
  const parsed = BackupService.parseAnimeBoxesBackup({ favorites: [original] }).posts[0];
  assert.equal(parsed.previewVideoUrl, original.previewVideoUrl);
  assert.equal(parsed.previewThumbUrl, original.previewThumbUrl);
  assert.deepEqual(Array.from(parsed.previewThumbs), ['https://cdn.test/1.jpg', 'https://cdn.test/2.jpg']);
});
