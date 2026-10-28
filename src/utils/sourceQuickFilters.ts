import type { BooruSource, SearchFilterConfig } from '../types/booru';

export interface SourceQuickFilter {
  id: string;
  label: string;
  kind: 'order' | 'toggle' | 'genre';
  patch: Partial<SearchFilterConfig>;
}

const order = (id: string, label: string, sortBy: SearchFilterConfig['sortBy'], timeRange: SearchFilterConfig['timeRange'] = 'all'): SourceQuickFilter =>
  ({ id, label, kind: 'order', patch: { sortBy, timeRange } });
const latest = order('latest', 'Latest', 'id');
const top = order('top', 'Top · All time', 'score');
const week = order('week', 'Weekly Top', 'score', '1w');
const month = order('month', 'Monthly Top', 'score', '1m');
const day = order('day', 'Daily Top', 'score', '1d');
const relevance = order('default', 'Relevance', 'default');
const discover = order('default', 'Discover', 'default');
const safe: SourceQuickFilter = { id: 'safe', label: 'Safe', kind: 'toggle', patch: { rating: 'safe' } };
const score: SourceQuickFilter = { id: 'score50', label: '50+ Points', kind: 'toggle', patch: { minScore: 50 } };

/** Only expose controls the adapter actually sends. Feed and keyword-search
 * differ: PH discover ignores sort, Realbooru has no date-window adapter,
 * and Gelbooru's HTML fallback cannot honor weekly/monthly bounds. */
export function getSourceQuickFilters(source: BooruSource, context: 'feed' | 'search', hasQuery = false): SourceQuickFilter[] {
  const search = context === 'search';
  switch (source.type) {
    case 'danbooru':
    case 'moebooru':
      return [latest, top, week, month, ...(search ? [safe, score] : [])];
    case 'gelbooru':
    case 'realbooru':
      return [latest, top, ...(search ? [safe, score] : [])];
    case 'redgifs':
      return [order('default', 'Trending', 'default'), latest, week, month];
    case 'cumst':
      // /posts/popular is a keywordless leaderboard. With q=... this adapter
      // switches to /posts and loses period, so don't promise timed search tops.
      return [latest, ...(hasQuery ? [] : [day, week, month]), ...(search ? [
        { id: 'videos', label: 'Videos', kind: 'toggle' as const, patch: { cumstMediaType: 'videos' as const } },
        { id: 'onlyfans', label: 'OnlyFans', kind: 'toggle' as const, patch: { cumstService: 'onlyfans' as const } },
        { id: 'fansly', label: 'Fansly', kind: 'toggle' as const, patch: { cumstService: 'fansly' as const } },
      ] : [])];
    case 'xvideos':
      return search && hasQuery ? [relevance, latest, top, week, month, order('rated', 'Top Rated', 'rating')] : [discover, latest, order('monthly-best', 'Monthly Best', 'score', '1m')];
    case 'xhamster':
      return search && hasQuery ? [relevance, latest, top, week, month, order('rated', 'Top Rated', 'rating')] : [discover, top, week, month];
    case 'pornhub':
      return search && hasQuery ? [relevance, latest, top, week, month, order('rated', 'Top Rated', 'rating')] : [discover];
    case 'sexcom':
      return [];
    case 'nhentai':
      return [latest, day, week, month, top];
    case 'hentaihaven':
      return [
        ...['latest', 'trending', 'episodes', 'yuri', 'ecchi', 'incest', 'tentacle', 'uncensored'].map((section): SourceQuickFilter => ({
          id: section, label: ({ latest: 'Latest', trending: 'Monthly Trends', episodes: 'Latest Episodes' } as Record<string, string>)[section] || section[0].toUpperCase() + section.slice(1),
          kind: 'order', patch: { sortBy: 'default', timeRange: 'all', hentaiHavenSection: section as SearchFilterConfig['hentaiHavenSection'], ...(search ? { tags: [] } : {}) },
        })),
        ...(search ? ['harem', 'anal', 'milf', 'bdsm'].map((genre): SourceQuickFilter => ({ id: `genre-${genre}`, label: genre[0].toUpperCase() + genre.slice(1), kind: 'genre', patch: { tags: [genre], sortBy: 'default', timeRange: 'all', hentaiHavenSection: undefined } })) : []),
      ];
    default:
      return [];
  }
}

export function isQuickFilterActive(option: SourceQuickFilter, filter: Partial<SearchFilterConfig>): boolean {
  return Object.entries(option.patch).every(([key, value]) => {
    const actual = filter[key as keyof SearchFilterConfig];
    if (Array.isArray(value)) return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(value);
    if (key === 'hentaiHavenSection') return (actual ?? 'latest') === (value ?? 'latest');
    return actual === value;
  });
}

export function applyQuickFilter(option: SourceQuickFilter, filter: SearchFilterConfig, toggle = true): SearchFilterConfig {
  const next = { ...filter, ...option.patch, jumpToPage: 1 };
  if (option.kind === 'toggle' && toggle && isQuickFilterActive(option, filter)) {
    if (option.id === 'safe') next.rating = 'all';
    if (option.id === 'score50') next.minScore = undefined;
    if (option.id === 'videos') next.cumstMediaType = 'all';
    if (option.id === 'onlyfans' || option.id === 'fansly') next.cumstService = 'all';
  }
  // Cum.st's popular endpoint ignores service/type filters. Switching either
  // side resets the incompatible side instead of lighting a no-op button.
  if (option.id === 'videos' || option.id === 'onlyfans' || option.id === 'fansly') {
    next.sortBy = 'id'; next.timeRange = 'all'; next.leaderboardDate = undefined;
  } else if (['day', 'week', 'month'].includes(option.id)) {
    next.cumstMediaType = 'all'; next.cumstService = 'all';
  }
  return next;
}

export function normalizeFeedQuickFilter(source: BooruSource, saved: Partial<SearchFilterConfig>): Partial<SearchFilterConfig> {
  const options = getSourceQuickFilters(source, 'feed');
  return options.find((o) => isQuickFilterActive(o, saved))?.patch ?? options[0]?.patch ?? { sortBy: 'default', timeRange: 'all' };
}
