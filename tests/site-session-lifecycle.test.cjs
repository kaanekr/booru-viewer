const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader } = require('./helpers/load-typescript.cjs');

test('siteSession stores and clears cookies/bearer tokens and reads native WKHTTPCookieStore', async () => {
  const store = new Map();
  let clearedDomain = '';
  const load = createLoader({
    '@react-native-async-storage/async-storage': {
      default: {
        getItem: async (k) => store.get(k) ?? null,
        setItem: async (k, v) => { store.set(k, v); },
      },
    },
    expo: {
      requireOptionalNativeModule: (name) => name === 'BooruHlsCache' ? {
        getWebViewCookies: async (domain) => domain === 'pornhub.com' ? 'ss=abc; platform=mobile' : '',
        clearWebViewCookies: async (domain) => { clearedDomain = domain; },
      } : null,
    },
  });
  const session = load(path.resolve(__dirname, '../src/services/siteSession.ts'));
  const ph = { id: 'pornhub', type: 'pornhub', name: 'Pornhub', baseUrl: 'https://www.pornhub.com' };
  const rg = { id: 'redgifs', type: 'redgifs', name: 'RedGifs', baseUrl: 'https://api.redgifs.com' };

  assert.equal(session.supportsSiteAccount(ph), true);
  assert.equal(session.supportsSiteAccount(rg), true);
  assert.equal(session.supportsSiteAccount({ id: 'danbooru', type: 'danbooru' }), false);

  const captured = await session.captureNativeSiteCookies(ph);
  assert.equal(captured, 'ss=abc; platform=mobile');
  assert.equal(session.hasSiteSession('pornhub'), true);
  assert.equal(session.getSiteCookieHeader('pornhub'), 'ss=abc; platform=mobile');

  await session.saveSiteSession('redgifs', {
    bearerToken: 'eyJuser.token.sig',
    feedUrl: 'https://api.redgifs.com/v2/feeds/home?sexuality=gay&page=1',
  });
  assert.equal(session.hasSiteSession('redgifs'), true);
  assert.equal(session.getSiteBearerToken('redgifs'), 'eyJuser.token.sig');
  assert.equal(session.getSiteFeedUrl('redgifs'), 'https://api.redgifs.com/v2/feeds/home?sexuality=gay&page=1');

  await session.clearSiteSession(ph);
  assert.equal(session.hasSiteSession('pornhub'), false);
  assert.equal(clearedDomain, 'pornhub.com');
});

function makeJwt(payload) {
  const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${hdr}.${body}.sig`;
}

test('booruApi uses pure fetch with saved session Cookie for Pornhub/XHamster Recommended and Bearer+valid_agent for RedGifs', async () => {
  const requests = [];
  const validUserJwt = makeJwt({
    sub: 'user/realuser',
    valid_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Safari/604.1',
  });
  const load = createLoader({
    './storage': { StorageService: { getBlacklistedTags: async () => [] } },
    './proxyService': {
      proxyService: {
        ensureInitialized: async () => {},
        isEnabled: () => false,
        getWorkerUrl: () => '',
        fetchWithFallback: async (url, init) => {
          requests.push({ url, headers: init?.headers || {} });
          if (url.includes('pornhub.com/recommended')) {
            return {
              ok: true,
              status: 200,
              text: async () => `
                <li data-video-vkey="ph777">
                  <a class="thumbnailTitle" title="Rec Clip" href="/view_video.php?viewkey=ph777">Rec Clip</a>
                  <img data-poster="https://cdn.ph.test/1.jpg" data-webm="https://cdn.ph.test/1_fb.mp4" />
                </li>`,
            };
          }
          if (url.includes('api.redgifs.com/v2/feeds/home')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                gifs: [{ id: 'rg1', userName: 'u1', tags: ['dance'], urls: { sd: 'https://cdn.rg/sd.mp4', thumbnail: 'https://cdn.rg/t.jpg' } }],
              }),
            };
          }
          return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
        },
      },
    },
    './siteSession': {
      initSiteSessions: async () => {},
      getSiteCookieHeader: (id) => (id === 'pornhub' ? 'ss=my_session' : ''),
      getSiteBearerToken: (id) => (id === 'redgifs' ? validUserJwt : ''),
      getSiteFeedUrl: (id) => (id === 'redgifs' ? 'https://api.redgifs.com/v2/feeds/home?sexuality=gay&page=1' : ''),
      getSiteUserAgent: () => '',
      saveSiteSession: async () => {},
    },
  });
  const { BooruApiService } = load(path.resolve(__dirname, '../src/services/booruApi.ts'));
  const { AVAILABLE_SOURCES } = load(path.resolve(__dirname, '../src/services/sources.ts'));
  const { DEFAULT_FILTER_CONFIG } = load(path.resolve(__dirname, '../src/types/booru.ts'));
  const api = new BooruApiService();

  const phSource = AVAILABLE_SOURCES.find((s) => s.id === 'pornhub');
  const phPosts = await api.fetchPosts(1, 24, '', { ...DEFAULT_FILTER_CONFIG, sortBy: 'recommended' }, phSource);
  assert.equal(phPosts.length, 1);
  assert.equal(phPosts[0].id, 'ph_ph777');
  assert.match(requests[0].headers.Cookie, /ss=my_session/);

  const rgSource = AVAILABLE_SOURCES.find((s) => s.id === 'redgifs');
  const rgPosts = await api.fetchPosts(2, 24, '', { ...DEFAULT_FILTER_CONFIG, sortBy: 'recommended' }, rgSource);
  assert.equal(rgPosts.length, 1);
  assert.equal(rgPosts[0].id, 'rg_rg1');
  assert.equal(requests[1].url, 'https://api.redgifs.com/v2/feeds/home?sexuality=gay&page=2&count=24');
  assert.equal(requests[1].headers.Authorization, `Bearer ${validUserJwt}`);
  assert.equal(requests[1].headers['User-Agent'], 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Version/18.0 Safari/604.1');
});

test('booruApi rejects RedGifs temporary client/ JWTs on Recommended instead of calling feeds/home', async () => {
  let cleared = false;
  const tempGuestJwt = makeJwt({
    sub: 'client/1823c31f7d3-745a-6589-0005-d8e8fe0a44c2',
    scopes: 'read',
    valid_addr: '1.2.3.4',
  });
  const load = createLoader({
    './storage': { StorageService: { getBlacklistedTags: async () => [] } },
    './proxyService': {
      proxyService: {
        ensureInitialized: async () => {},
        isEnabled: () => false,
        getWorkerUrl: () => '',
        fetchWithFallback: async () => { throw new Error('Should not hit network with temporary guest token'); },
      },
    },
    './siteSession': {
      initSiteSessions: async () => {},
      getSiteCookieHeader: () => '',
      getSiteBearerToken: () => tempGuestJwt,
      getSiteFeedUrl: () => '',
      getSiteUserAgent: () => '',
      saveSiteSession: async (_id, patch) => { if (patch.bearerToken === '') cleared = true; },
    },
  });
  const { BooruApiService } = load(path.resolve(__dirname, '../src/services/booruApi.ts'));
  const { AVAILABLE_SOURCES } = load(path.resolve(__dirname, '../src/services/sources.ts'));
  const { DEFAULT_FILTER_CONFIG } = load(path.resolve(__dirname, '../src/types/booru.ts'));
  const api = new BooruApiService();
  const rgSource = AVAILABLE_SOURCES.find((s) => s.id === 'redgifs');

  await assert.rejects(
    api.fetchPosts(1, 24, '', { ...DEFAULT_FILTER_CONFIG, sortBy: 'recommended' }, rgSource),
    /Sign in to RedGifs/
  );
  assert.equal(cleared, true);
});
