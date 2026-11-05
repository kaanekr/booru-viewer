// Opt-in live smoke audit. Does not run in the unit-test suite or read app keys.
// Optional Rule34 credentials are supplied through environment variables only.
const fs = require('node:fs');
const path = require('node:path');
const { createLoader } = require('../tests/helpers/load-typescript.cjs');
const cache = new Map();
const reportPath = path.resolve(__dirname, '../docs/quick-filter-audit.json');
const selectedSources = process.argv[2]?.split(',');
const previous = selectedSources && fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')).results.filter((r) => !selectedSources.includes(r.source)) : [];
const report = { checkedAt: new Date().toISOString(), transport: 'direct (no device relay)', results: previous };
const quiet = { ...console, warn() {} };
const summary = (url) => {
  const parsed = new URL(url);
  for (const key of ['api_key', 'user_id', 'token']) if (parsed.searchParams.has(key)) parsed.searchParams.set(key, '[redacted]');
  return parsed.toString();
};
async function checkSource(source, library) {
  let routes = [];
  let lastStatus = 0;
  const send = async (url, init = {}) => {
    routes.push(summary(url));
    const key = `${init.method || 'GET'} ${url} ${init.body || ''}`;
    if (cache.has(key)) {
      const saved = cache.get(key);
      lastStatus = saved.status;
      return new Response(saved.body, saved);
    }
    const response = await fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(12000), ...(init.signal ? [init.signal] : [])]) });
    lastStatus = response.status;
    const body = await response.text();
    const saved = { body, status: response.status, headers: Object.fromEntries(response.headers) };
    cache.set(key, saved);
    return new Response(body, saved);
  };
  const load = createLoader({
    './proxyService': { proxyService: { fetchWithFallback: send, ensureInitialized: async () => {}, isEnabled: () => false, getWorkerUrl: () => '', isProxiedUrl: () => false } },
    './storage': { StorageService: {
      getBlacklistedTags: async () => [],
      getGelbooruAuth: async () => ({ userId: '', apiKey: '' }),
      getRule34Auth: async () => ({ userId: process.env.RULE34_USER_ID || '', apiKey: process.env.RULE34_API_KEY || '' }),
    } },
  }, { fetch: send, console: quiet });
  const api = new (load(path.resolve(__dirname, '../src/services/booruApi.ts')).BooruApiService)();
  const defaults = load(path.resolve(__dirname, '../src/types/booru.ts')).DEFAULT_FILTER_CONFIG;
  const modes = ['feed', 'search'];
  const completed = new Map();
  for (const mode of modes) {
    const tags = mode === 'search' ? [source.type === 'danbooru' || source.type === 'moebooru' || source.type === 'gelbooru' ? 'landscape' : 'cosplay'] : [];
    for (const option of library.getSourceQuickFilters(source, mode, tags.length > 0)) {
      const filter = library.applyQuickFilter(option, { ...defaults, tags, includeBlacklisted: true }, false);
      // Reuse identical config probes across surfaces; an HTTP success is not
      // proof of semantics, so retain routes and first IDs/scores for comparison.
      const signature = JSON.stringify(filter);
      routes = []; lastStatus = 0;
      let entry = completed.get(signature);
      if (!entry) {
        try {
          const posts = await api.fetchPostsWithFilter(filter, 1, 12, source);
          entry = { status: posts.length ? 'parsed' : 'empty', count: posts.length, httpStatus: lastStatus,
            ids: posts.slice(0, 8).map((p) => p.id), scores: posts.slice(0, 8).map((p) => p.score),
            ratings: [...new Set(posts.map((p) => p.rating))], routes: [...new Set(routes)] };
        } catch (e) {
          entry = { status: /requires your own API key/i.test(e.message) ? 'credentials-required' : 'blocked-or-error', httpStatus: lastStatus, error: e.message.replace(/((?:api_key|user_id|token)=)[^&\s]+/gi, '$1[redacted]').slice(0, 220), routes: [...new Set(routes)] };
        }
        completed.set(signature, entry);
      }
      const result = { source: source.id, mode, button: option.id, label: option.label, ...entry };
      report.results.push(result);
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
      console.log(`${source.id} ${mode} ${option.id}: ${entry.status} (${entry.count ?? entry.httpStatus})`);
      // Be gentle on hosts (notably nhentai v2's ~10 requests/minute).
      await new Promise((resolve) => setTimeout(resolve, source.type === 'nhentai' ? 6200 : 250));
    }
  }
}
async function main() {
  const load = createLoader();
  const sources = load(path.resolve(__dirname, '../src/services/sources.ts')).AVAILABLE_SOURCES;
  const library = load(path.resolve(__dirname, '../src/utils/sourceQuickFilters.ts'));
  // Two independent providers at once; never parallelize requests to one host.
  const queue = sources.filter((s) => !selectedSources || selectedSources.includes(s.id));
  await Promise.all([0, 1].map(async () => { while (queue.length) await checkSource(queue.shift(), library); }));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
