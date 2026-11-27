const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./helpers/load-typescript.cjs');

const XV_LISTING = '<div id="video_abcd" data-id="123"><a href="/video.abcd/test"></a><img src="https://img.test/preview.jpg"></div>';
const XH_INITIALS = (data) => `<script id="initials-script">window.initials=${JSON.stringify(data)};</script>`;
const XH_LISTING = '<div data-video-id="42"><a href="/videos/test-42" data-role="thumb-link"></a><img src="https://img.test/preview.jpg"></div>';

function setup(fetchWithFallback) {
  const proxyService = { fetchWithFallback, ensureInitialized: async () => {}, isEnabled: () => false };
  const load = createLoader({
    './proxyService': { proxyService },
    '../services/proxyService': { proxyService },
    './storage': { StorageService: { getBlacklistedTags: async () => [] } },
    'react-native': { Platform: { OS: 'web' } },
  }, { console: { log() {}, warn() {} } });
  const src = (file) => load(path.resolve(__dirname, '../src', file));
  const { BooruApiService } = src('services/booruApi.ts');
  const { DEFAULT_FILTER_CONFIG } = src('types/booru.ts');
  const { AVAILABLE_SOURCES } = src('services/sources.ts');
  const api = new BooruApiService();
  return {
    api, src,
    source: (id) => AVAILABLE_SOURCES.find((s) => s.id === id),
    filter: (tags) => ({ ...DEFAULT_FILTER_CONFIG, tags, includeBlacklisted: true }),
  };
}

test('XVideos uses its own tag index and opens the paged source tag results', async () => {
  const calls = [];
  const { api, src, source, filter } = setup(async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    return new Response(parsed.pathname === '/tags'
      ? '<a href="/tags/retro-costume"><b>Retro Costume </b><span class="navbadge default">1,300</span></a><a href="/tags/retro-costume">retro costume</a>'
      : XV_LISTING);
  });
  const { sourceTagQuery } = src('utils/tagSearch.ts');
  const xv = source('xvideos');
  const [tag] = await api.searchTags('retro_c', 12, xv);
  assert.equal(tag.name, 'Retro Costume');
  assert.equal((await api.fetchSourceTags(xv)).length, 1);
  const posts = await api.fetchPostsWithFilter(filter([sourceTagQuery(xv.type, tag.name, tag.category)]), 2, 24, xv);
  assert.equal(posts[0].id, 'xv_123');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].pathname, '/tags/retro-costume/1');
});

test('Realbooru preserves compound listing tags and searches the native underscore token', async () => {
  const requests = [];
  const { api, src, source, filter } = setup(async (url) => {
    requests.push(new URL(url));
    return new Response('<div class="thumb" id="s42"><a href="/index.php?page=post&amp;s=view&amp;id=42">' +
      '<img src="/thumbnails/ab/cd/thumbnail_deadbeef.jpg" title="brown eyes, blue jacket, brown_eyes"></a></div>');
  });
  const rb = source('realbooru');
  const { sourceTagQuery } = src('utils/tagSearch.ts');
  const [post] = await api.fetchPostsWithFilter(filter([]), 1, 24, rb);
  assert.deepEqual(Array.from(post.tags.general), ['brown_eyes', 'blue_jacket']);

  await api.fetchPostsWithFilter(filter([sourceTagQuery(rb.type, post.tags.general[0], 'general')]), 1, 24, rb);
  assert.equal(requests.at(-1).searchParams.get('tags'), 'brown_eyes');
});

test('Cum.st distinguishes creator suggestions from real tags', async () => {
  const { api, source } = setup(async (url) => {
    if (new URL(url).pathname === '/api/v1/creators') {
      return Response.json({ creators: [{ id: '17', service: 'patreon', name: 'costumeartist', displayName: 'Costume Artist', postCount: 10 }] });
    }
    assert.equal(new URL(url).pathname, '/api/v1/tags');
    return Response.json({ tags: [{ slug: 'costume', label: 'Costume', posts: 5 }] });
  });
  const tags = await api.searchTags('costume', 12, source('cumst'));
  assert.deepEqual(Array.from(tags, ({ name, isTag }) => [name, isTag]), [
    ['costume', undefined],
    ['costumeartist', false],
  ]);
  assert.equal(tags[1].cumstCreator.id, '17');
  assert.equal((await api.searchTags('costume', 1, source('cumst')))[0].name, 'costume');
});

test('Cum.st resolves exact creators and paginates their own post feed by platform and ID', async () => {
  const calls = [];
  const { api, source, filter } = setup(async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    if (parsed.pathname === '/api/v1/creators') {
      return Response.json({ creators: [
        { id: '17', service: 'patreon', name: 'studio_name', displayName: 'Studio Name', postCount: 2 },
        { id: '32', service: 'fansly', name: 'studio_name_alt', displayName: 'Other Studio', postCount: 5 },
      ] });
    }
    return Response.json({
      posts: [{
        id: '456',
        service: 'patreon',
        attachments: [{ sha256: 'abc123', kind: 'image', variants: [{ name: 'original.jpg' }] }],
      }],
    });
  });
  const cumst = source('cumst');
  const creator = await api.findCumStCreator(cumst, '@studio_name');
  assert.equal(creator.id, '17');
  assert.equal(calls[0].searchParams.get('q'), 'studio_name');
  assert.equal((await api.findCumStCreator(cumst, 'Studio Name')).id, '17');
  assert.equal(await api.findCumStCreator(cumst, 'studio'), undefined);

  const [post] = await api.fetchPostsWithFilter(filter(['creator:"Studio Name"']), 1, 50, cumst);
  assert.equal(calls.at(-1).pathname, '/api/v1/patreon/user/17/posts');
  assert.equal(calls.at(-1).searchParams.has('q'), false);
  assert.equal(post.sourceLink, 'https://cum.st/creators/patreon/17/post/456');
  assert.deepEqual(Array.from(post.tags.artist), ['studio_name']);

  const before = calls.length;
  await api.fetchPostsWithFilter({ ...filter(['"costume preview"']), cumstCreator: creator, cumstMediaType: 'videos' }, 2, 50, cumst);
  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1).pathname, '/api/v1/patreon/user/17/posts');
  assert.equal(calls.at(-1).searchParams.get('o'), '50');
  assert.equal(calls.at(-1).searchParams.get('q'), 'costume preview');
  assert.equal(calls.at(-1).searchParams.get('type'), 'videos');
});

test('RedGifs only identifies tag-type API suggestions as tags', async () => {
  const { api, source } = setup(async (url) => {
    if (new URL(url).pathname === '/v2/auth/temporary') return Response.json({ token: 'test-token' });
    assert.equal(new URL(url).pathname, '/v2/search/suggest');
    return Response.json([
      { text: 'Example Tag', type: 'tag', gifs: 5 },
      { text: 'Example User', type: 'user', gifs: 2 },
    ]);
  });
  const tags = await api.searchTags('example', 12, source('redgifs'));
  assert.deepEqual(Array.from(tags, ({ name, isTag }) => [name, isTag]), [
    ['example_tag', true],
    ['example_user', false],
  ]);
});

test('XHamster uses its related searches and keeps the multiword term on later pages', async () => {
  const requests = [];
  const { api, source, filter } = setup(async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.pathname === '/categories') return new Response('<a href="/categories/comedy" data-role="tag-link">Comedy</a>');
    return new Response(XH_LISTING + XH_INITIALS({ searchVideoSuggestions: { tags: [{ text: 'Retro Costume', plainText: 'Retro Costume' }] } }));
  });
  const xh = source('xhamster');
  assert.equal((await api.fetchSourceTags(xh))[0].category, 'copyright');
  assert.equal((await api.searchTags('retro', 12, xh))[0].name, 'Retro Costume');
  const posts = await api.fetchPostsWithFilter(filter(['"retro costume"', '-"old clip"']), 2, 24, xh);
  assert.equal(posts[0].id, 'xh_42');
  assert.equal(decodeURIComponent(requests.at(-1).pathname), '/search/retro costume');
  assert.equal(requests.at(-1).searchParams.get('page'), '2');
});

test('Pornhub suggests returned tags, uses the tag parameter, and verifies required and excluded tags', async () => {
  const requests = [];
  const entry = (id, ...names) => ({
    video_id: id, thumb: 'https://img.test/preview.jpg',
    tags: names.map((tag_name) => ({ tag_name })),
  });
  const { api, src, source, filter } = setup(async (url) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (!parsed.pathname.startsWith('/webmasters/')) return new Response('');
    return Response.json({ videos: [
      entry('1', 'retro costume', 'comedy'),
      entry('2', 'retro costume', 'comedy', 'compilation'),
      entry('3', 'retro costume'),
      entry('4', 'comedy'),
    ] });
  });
  const ph = source('pornhub');
  const { sourceTagQuery } = src('utils/tagSearch.ts');
  const [tag] = await api.searchTags('retro cos', 12, ph);
  assert.equal(tag.name, 'retro_costume');
  const posts = await api.fetchPostsWithFilter(filter([sourceTagQuery(ph.type, tag.name, tag.category), 'tag:comedy', '-tag:compilation']), 2, 24, ph);
  const search = requests.find((req) => req.searchParams.has('tags[]'));
  assert.equal(search.searchParams.get('tags[]'), 'retro costume');
  assert.equal(search.searchParams.get('search'), '');
  assert.equal(search.searchParams.get('page'), '2');
  assert.deepEqual(Array.from(posts, (post) => post.id), ['ph_1']);
});

test('video detail resolvers provide source tags even while no stream is available', async () => {
  const { src } = setup(async (url) => {
    const { hostname, pathname } = new URL(url);
    if (hostname.includes('xvideos')) return new Response('<a href="/tags/retro-costume">Retro &amp; Costume</a>');
    if (hostname.includes('xhamster')) return new Response(XH_INITIALS({ videoTagsComponent: { tags: [
      { name: 'Sample Studio', isUploader: true }, { name: 'Comedy', isCategory: true }, { name: 'Retro Costume' },
    ] } }));
    assert.equal(pathname, '/webmasters/video_by_id');
    return Response.json({ video: { tags: [{ tag_name: 'Retro Costume' }], categories: [{ category: 'Comedy' }] } });
  });
  const media = src('utils/media.ts');
  const xv = await media.resolveXVideosVideoUrls({ sourceLink: 'https://www.xvideos.com/video.abcd/test' });
  assert.deepEqual(Array.from(xv.tags), ['Retro & Costume']);
  const xh = await media.resolveXHamsterVideoUrls({ sourceLink: 'https://xhamster.com/videos/test-42' });
  assert.deepEqual(Array.from(xh.tagGroups.artist), ['Sample Studio']);
  assert.deepEqual(Array.from(xh.tagGroups.copyright), ['Comedy']);
  assert.deepEqual(Array.from(xh.tagGroups.general), ['Retro Costume']);
  const ph = await media.resolvePornhubTags({ id: 'ph_abcd' }, new AbortController().signal);
  assert.deepEqual(Array.from(ph.general), ['retro_costume']);
  assert.deepEqual(Array.from(ph.copyright), ['comedy']);
});
