import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  FlatList,
  Keyboard,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Search,
  X,
  Clock,
  Flame,
  ArrowLeft,
  Image as ImageIcon,
  SlidersHorizontal,
  Pin,
  Layers,
  AlertCircle,
  RefreshCw,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { booruApi } from '../services/booruApi';
import { nhentaiTagQuery } from '../services/nhentai';
import { hentaiHavenTagQuery } from '../services/hentaihavens';
import { useNavigation, type RouteProp, useIsFocused } from '@react-navigation/native';
import {
  BooruPost,
  BooruSource,
  BooruTagSuggestion,
  RedGifsNiche,
  SearchFilterConfig,
  TagCategory,
  DEFAULT_FILTER_CONFIG,
} from '../types/booru';
import type { TabParamList, SearchMode } from '../navigation/types';
import { StorageService } from '../services/storage';
import { PostCard } from '../components/PostCard';
import { TagChip } from '../components/TagChip';
import { applyQuickFilter, getSourceQuickFilters, isQuickFilterActive, SourceQuickFilter } from '../utils/sourceQuickFilters';
import { useScrollAwayHeader } from '../utils/scrollAwayHeader';
import { ScrollAwayHeader } from '../components/ScrollAwayHeader';
import { pushViewer } from '../navigation/rootNavigation';
import { getPostKey } from '../utils/postIdentity';
import { getGridPreviewVideoCandidates } from '../utils/gridPreviewMedia';
import { SearchFilterModal } from '../components/SearchFilterModal';
import { SourceSheet } from '../components/SourceSheet';
import { Colors } from '../theme/colors';
import { getMediaHeaders, getMediaUrl, isImageMediaUrl } from '../utils/media';
import { useVisibleIds, useMountedIds, useFocusedCardIds, CardLayout } from '../utils/gridVisibility';
import { useMediaPlaybackAllowed } from '../context/MediaPlaybackContext';
import { useSource } from '../context/SourceContext';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GOLD_ACCENT = '#F5A623';

const POPULAR_TAGS = [
  'original',
  '1girl',
  'hatsune_miku',
  'scenery',
  'genshin_impact',
  'arknights',
  'hololive',
  'frieren',
  'blue_archive',
  'cyberpunk',
];

interface SearchScreenProps {
  route?: RouteProp<TabParamList, 'Search'>;
  navigation?: any;
  initialTag?: string;
  initialMode?: SearchMode;
  initialFilter?: SearchFilterConfig;
  activeSource?: BooruSource;
  onClearInitialTag?: () => void;
  onOpenSourcePicker?: () => void;
  onBackPress?: () => void;
}

export const SearchScreen: React.FC<SearchScreenProps> = ({
  route,
  navigation: propNavigation,
  initialTag,
  initialMode,
  initialFilter,
  activeSource: propSource,
  onClearInitialTag,
  onOpenSourcePicker,
  onBackPress,
}) => {
  const hookNavigation = useNavigation<any>();
  const navigation = propNavigation ?? hookNavigation;
  const { activeSource: contextSource, selectSource } = useSource();
  const [localSource, setLocalSource] = useState<BooruSource | null>(null);
  const activeSource = localSource ?? propSource ?? contextSource;
  useEffect(() => { setLocalSource(null); }, [propSource]);
  const handleSelectSource = useCallback(async (source: BooruSource) => {
    // A search opened from a post owns its source; don't change unrelated screens.
    if (propSource) setLocalSource(source);
    else await selectSource(source);
  }, [propSource, selectSource]);
  const [isSourceSheetOpen, setIsSourceSheetOpen] = useState(false);

  const handleManageSources = () => {
    setIsSourceSheetOpen(false);
    navigation?.navigate?.('Settings', { section: 'sources' });
  };

  const handleOpenSourcePicker = () => {
    if (onOpenSourcePicker) {
      onOpenSourcePicker();
    } else {
      setIsSourceSheetOpen(true);
    }
  };

  const showSourcePicker = true;
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [favoriteTags, setFavoriteTags] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<BooruTagSuggestion[]>([]);
  const [isInputFocused, setIsInputFocused] = useState(false);

  // Filter Configuration State
  const [filterConfig, setFilterConfig] = useState<SearchFilterConfig>(DEFAULT_FILTER_CONFIG);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);

  // Search Results State
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [results, setResults] = useState<BooruPost[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [searchError, setSearchError] = useState<string | null>(null);
  // Video covers play only while on screen (prevents stutter)
  const [visibleIds, updateVisible] = useVisibleIds();
  // Focused-player architecture: the 2-4 cards nearest the center play video
  const [focusedIds, updateFocused] = useFocusedCardIds(80, 4);
  // Mount window: distant results fall back to placeholders (see FeedScreen).
  const [mountedIds, updateMounted] = useMountedIds();
  const searchOffsetRef = useRef(0);
  const gridTopRef = useRef(0);
  const viewportHeightRef = useRef(SCREEN_HEIGHT);
  // RedGifs niches (kategoriler)
  const [niches, setNiches] = useState<RedGifsNiche[]>([]);
  const [nichesLoading, setNichesLoading] = useState(false);
  const isFocused = useIsFocused();
  const mediaAllowed = useMediaPlaybackAllowed();
  const header = useScrollAwayHeader({
    enabled: isSearchActive && !loading && !searchError && results.length > 0,
    resetKey: activeSource.id,
    pinned: !isFocused || isInputFocused || isFilterModalOpen || isSourceSheetOpen,
  });

  // Refresh the fav set when returning to the cover — items faved in the viewer badge instantly
  useEffect(() => {
    if (isFocused) {
      StorageService.getFavorites().then((favs) => {
        setFavoriteIds(new Set(favs.map(getPostKey)));
      });
    }
  }, [isFocused]);

  // Source Tracking & Race Condition Prevention Refs
  const lastActiveSourceIdRef = useRef(activeSource.id);
  const searchRequestIdRef = useRef(0);
  const paginationPendingRef = useRef<number | null>(null);
  const hasMoreRef = useRef(true);
  const resultsRef = useRef<BooruPost[]>([]);
  const currentPageRef = useRef<number>(1);
  const filterConfigRef = useRef<SearchFilterConfig>(filterConfig);

  useEffect(() => {
    filterConfigRef.current = filterConfig;
  }, [filterConfig]);

  useEffect(() => () => { searchRequestIdRef.current++; }, []);

  const routeParams = route?.params;
  const effectiveTag = initialTag ?? routeParams?.tag;
  const effectiveMode = initialMode ?? routeParams?.mode ?? 'replace';

  useEffect(() => {
    StorageService.getSearchHistory().then(setHistory);
    StorageService.getFavoriteTags().then(setFavoriteTags);
  }, [isSearchActive]);

  // RedGifs niches: load trends on the explore screen while redgifs is active
  useEffect(() => {
    if (isSearchActive || activeSource.type !== 'redgifs') {
      return;
    }
    let cancelled = false;
    setNichesLoading(true);
    booruApi
      .fetchRedGifsNiches()
      .then((list) => {
        if (!cancelled) setNiches(list);
      })
      .catch(() => {
        if (!cancelled) setNiches([]);
      })
      .finally(() => {
        if (!cancelled) setNichesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isSearchActive, activeSource.id]);

  // Stable key for initialFilter/initialTag to prevent re-search loops on parent re-renders
  const lastInitialKeyRef = useRef<string>('');
  const initialFilterKey = initialFilter
    ? `${JSON.stringify(initialFilter.tags)}|${initialFilter.rating}|${initialFilter.sortBy}|${initialFilter.timeRange}|${initialFilter.minScore ?? ''}|${initialFilter.cumstService ?? ''}|${initialFilter.cumstMediaType ?? ''}|${initialFilter.jumpToPage}|${initialFilter.hentaiHavenSection ?? ''}`
    : '';
  const initialTagKey = effectiveTag ? `${effectiveTag}:${effectiveMode}` : '';
  const combinedInitialKey = initialFilterKey ? `f:${initialFilterKey}` : initialTagKey ? `t:${initialTagKey}` : '';

  useEffect(() => {
    if (!combinedInitialKey) {
      lastInitialKeyRef.current = '';
      return;
    }
    if (lastInitialKeyRef.current === combinedInitialKey) return;
    lastInitialKeyRef.current = combinedInitialKey;

    if (initialFilter) {
      setFilterConfig(initialFilter);
      if (initialFilter.tags && initialFilter.tags.length > 0) {
        setQuery(initialFilter.tags.join(' '));
      }
      executeSearchWithConfig(initialFilter);
      if (onClearInitialTag) {
        onClearInitialTag();
      }
    } else if (effectiveTag) {
      executeSearch(effectiveTag, effectiveMode);
      if (onClearInitialTag) {
        onClearInitialTag();
      } else if (navigation?.setParams) {
        navigation.setParams({ tag: undefined, mode: undefined });
      }
    }
  }, [combinedInitialKey]);

  // Reset search state and cancel ongoing requests when active source changes
  useEffect(() => {
    if (lastActiveSourceIdRef.current !== activeSource.id) {
      lastActiveSourceIdRef.current = activeSource.id;
      // Invalidate any ongoing asynchronous search or tag suggestion requests
      searchRequestIdRef.current += 1;
      paginationPendingRef.current = null;
      hasMoreRef.current = true;
      resultsRef.current = [];

      setSuggestions([]);
      setResults([]);
      setIsSearchActive(false);
      setLoading(false);
      setLoadingMore(false);
      setPage(1);
      setFilterConfig({
        ...DEFAULT_FILTER_CONFIG,
        tags: query.trim() ? parseQueryToTags(query) : [],
      });
    }
  }, [activeSource.id, query]);

  // Autocomplete debounce - only triggers when search input is focused and guards for source match
  useEffect(() => {
    if (!isInputFocused || !filterConfig.autocompleteFromServer || !query) {
      setSuggestions([]);
      return;
    }

    // If it ends with a space the user has not started typing a new tag yet
    if (query.endsWith(' ')) {
      setSuggestions([]);
      return;
    }

    // For multi-tag searches base it on the tag currently being typed.
    // The `tag:"..."` prefix and quotes are stripped from the search (e.g. tag:"big bre -> big bre).
    const tokens = query.trim().split(/\s+/);
    const activeToken = tokens[tokens.length - 1] || '';
    const cleanToken = activeToken
      .replace(/^-+/, '')
      .replace(/^(tag|artist|character|parody|group|language|category):"?/i, '')
      .replace(/"$/, '')
      .trim();

    if (cleanToken.length < 2) {
      setSuggestions([]);
      return;
    }

    const currentSourceId = activeSource.id;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const list = await booruApi.searchTags(cleanToken, 12, activeSource);
        if (!cancelled && currentSourceId === lastActiveSourceIdRef.current) {
          setSuggestions(list);
        }
      } catch (e) {
        if (!cancelled && currentSourceId === lastActiveSourceIdRef.current) {
          setSuggestions([]);
        }
      }
    }, 250);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [query, isInputFocused, filterConfig.autocompleteFromServer, activeSource.id]);

  const executeSearchWithConfig = async (config: SearchFilterConfig) => {
    Keyboard.dismiss();
    setIsInputFocused(false);
    Haptics.selectionAsync();
    setSuggestions([]);
    setIsSearchActive(true);
    setLoading(true);
    setSearchError(null);
    setResults([]);
    resultsRef.current = [];
    paginationPendingRef.current = null;
    hasMoreRef.current = true;
    setLoadingMore(false);

    const requestId = ++searchRequestIdRef.current;
    const expectedSourceId = activeSource.id;
    const isCurrent = () => requestId === searchRequestIdRef.current && expectedSourceId === lastActiveSourceIdRef.current;

    const startPage = Math.max(1, config.jumpToPage || 1);
    setPage(startPage);
    currentPageRef.current = startPage;
    filterConfigRef.current = config;
    setFilterConfig(config);

    // Save full query to history (multi-tag searches stay as one bubble)
    if (config.tags.length > 0) {
      await StorageService.addSearchHistory(config.tags.join(' '));
      StorageService.getSearchHistory().then(setHistory);
    }
    if (!isCurrent()) return;

    // Fixed page limit: for jumpToPage > 1 fetch 100 posts for rate-limit protection and deep pages (docs default 100)
    const effectiveLimit = config.jumpToPage > 1 ? 100 : (activeSource.type === 'cumst' ? 50 : 24);

    // On a jump search scroll back to top — keep the user from sitting at the bottom of the old list
    try {
      resultsScrollRef.current?.scrollTo({ y: 0, animated: false });
    } catch {}

    try {
      const posts = await booruApi.fetchPostsWithFilter(config, startPage, effectiveLimit, activeSource);
      // Guard: Ignore response if newer search request was triggered
      if (!isCurrent()) {
        return;
      }

      posts.slice(0, 10).forEach((p) => {
        const raw = p.previewUrl || p.sampleUrl;
        if (!isImageMediaUrl(raw)) return;
        const u = getMediaUrl(raw);
        if (u) Image.prefetch(u, { headers: getMediaHeaders(u) }).catch(() => {});
      });
      resultsRef.current = posts;
      hasMoreRef.current = posts.length > 0;
      setResults(posts);
      if (posts.length === 0) {
        setSearchError('No results found');
      }
    } catch (e: any) {
      if (!isCurrent()) return;
      console.warn('Search with config error:', e);
      resultsRef.current = [];
      setResults([]);
      setSearchError(e?.message || 'An error occurred while fetching search results.');
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const handleSelectSuggestion = (suggestedTag: string, immediateSearch = false, category?: TagCategory) => {
    Haptics.selectionAsync();

    // nhentai / hentaihaven: if the suggestion is a real tag, search via the `tag:...` or `artist:...`
    // mechanism (like the other servers).
    const qualifiedTag =
      activeSource.type === 'nhentai'
        ? nhentaiTagQuery(suggestedTag, category)
        : activeSource.type === 'hentaihaven'
          ? hentaiHavenTagQuery(suggestedTag, category)
          : suggestedTag;

    const parts = query.match(/("[^"]*"|[^\s"])+/g) || [];
    let newQuery = '';

    if (parts.length > 0 && !query.endsWith(' ')) {
      const last = parts[parts.length - 1];
      const isNegated = last.startsWith('-');
      parts[parts.length - 1] = isNegated ? `-${qualifiedTag}` : qualifiedTag;
      newQuery = parts.filter(Boolean).join(' ') + ' ';
    } else {
      const existing = query.trim();
      newQuery = existing ? `${existing} ${qualifiedTag} ` : `${qualifiedTag} `;
    }

    setQuery(newQuery);
    setSuggestions([]);

    if (immediateSearch) {
      executeSearch(newQuery.trim(), 'replace');
    }
  };

  const parseQueryToTags = (raw: string): string[] => {
    // Quoted groups stay a single token: tag:"big breasts" is not split
    return (raw.trim().match(/("[^"]*"|[^\s"])+/g) || [])
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  };

  const executeSearch = (
    tagOrQuery: string,
    mode: 'replace' | 'add' | 'exclude' = 'replace'
  ) => {
    Keyboard.dismiss();
    setIsInputFocused(false);
    setSuggestions([]);

    const incomingTags = parseQueryToTags(tagOrQuery);

    let updatedTags: string[];

    if (mode === 'add') {
      // Empty query has nothing to add, but still search with the current filter
      const currentTags = filterConfig.tags || [];
      const newToAdd = incomingTags.filter((t) => !currentTags.includes(t));
      updatedTags = [...currentTags, ...newToAdd];
    } else if (mode === 'exclude') {
      const currentTags = filterConfig.tags || [];
      const negated = incomingTags.map((t) => (t.startsWith('-') ? t : `-${t}`));
      const newToAdd = negated.filter((t) => !currentTags.includes(t));
      updatedTags = [...currentTags, ...newToAdd];
    } else {
      updatedTags = incomingTags;
    }

    const queryStr = updatedTags.join(' ');
    setQuery(queryStr);

    // Retain all existing criteria (rating, sort, score, timeRange, cumst options)
    const newConfig: SearchFilterConfig = {
      ...filterConfig,
      tags: updatedTags,
      jumpToPage: 1,
    };
    setFilterConfig(newConfig);
    executeSearchWithConfig(newConfig);
  };

  const handleApplyFilterModal = (newConfig: SearchFilterConfig) => {
    setIsFilterModalOpen(false);
    setFilterConfig(newConfig);
    filterConfigRef.current = newConfig;
    setQuery(newConfig.tags.join(' '));
    executeSearchWithConfig(newConfig);
  };

  const handleCardPress = useCallback((post: BooruPost) => {
    const index = results.findIndex((item) => getPostKey(item) === getPostKey(post));
    if (index >= 0) pushViewer(results, index, filterConfig.tags, filterConfig, activeSource);
  }, [results, filterConfig, activeSource]);

  const loadMoreResults = async () => {
    if (!isFocused || !isSearchActive || loadingMore || loading || paginationPendingRef.current !== null || !hasMoreRef.current) return;
    const requestId = searchRequestIdRef.current;
    const expectedSourceId = activeSource.id;
    const isCurrent = () => requestId === searchRequestIdRef.current && expectedSourceId === lastActiveSourceIdRef.current;
    paginationPendingRef.current = requestId;

    setLoadingMore(true);
    const activeConfig = filterConfigRef.current || filterConfig;
    const currentBase = currentPageRef.current || page;
    const nextPage = currentBase + 1;

    const effectiveLimit = activeConfig.jumpToPage > 1 ? 100 : (activeSource.type === 'cumst' ? 50 : 24);

    try {
      const newPosts = await booruApi.fetchPostsWithFilter(activeConfig, nextPage, effectiveLimit, activeSource);
      if (!isCurrent()) {
        return;
      }

      newPosts.slice(0, 8).forEach((p) => {
        const raw = p.previewUrl || p.sampleUrl;
        if (!isImageMediaUrl(raw)) return;
        const u = getMediaUrl(raw);
        if (u) Image.prefetch(u, { headers: getMediaHeaders(u) }).catch(() => {});
      });
      // If a jump page comes back empty (out of range) roll the counter back so the loader does not stick
      if (newPosts.length === 0) {
        hasMoreRef.current = false;
        return;
      }
      const existingIds = new Set(resultsRef.current.map(getPostKey));
      const unique = newPosts.filter((p) => {
        const key = getPostKey(p);
        if (existingIds.has(key)) return false;
        existingIds.add(key);
        return true;
      });
      if (unique.length === 0) {
        hasMoreRef.current = false;
        return;
      }
      resultsRef.current = [...resultsRef.current, ...unique];
      setResults(resultsRef.current);
      setPage(nextPage);
      currentPageRef.current = nextPage;
    } catch (e) {
      if (!isCurrent()) return;
      // The page advances only on success, so retry fetches the same page.
      console.warn('Load more search error:', e);
    } finally {
      if (isCurrent() && paginationPendingRef.current === requestId) {
        paginationPendingRef.current = null;
        setLoadingMore(false);
      }
    }
  };

  const handleClearHistory = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await StorageService.clearSearchHistory();
    setHistory([]);
  };

  const handleExitSearch = () => {
    searchRequestIdRef.current++;
    paginationPendingRef.current = null;
    resultsRef.current = [];
    hasMoreRef.current = false;
    setLoading(false);
    setLoadingMore(false);
    setIsSearchActive(false);
    setResults([]);
    setPage(1);
    setQuery('');
    setFilterConfig(DEFAULT_FILTER_CONFIG);
  };

  const handleBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onBackPress) {
      onBackPress();
    } else {
      handleExitSearch();
    }
  };

  const resultsScrollRef = useRef<ScrollViewInstance>(null);

  const quickOptions = getSourceQuickFilters(activeSource, 'search', query.trim().length > 0);
  const handleQuickPreset = (option: SourceQuickFilter) => {
    // Also work before the first search, and use text currently in the input.
    const updated = applyQuickFilter(option, { ...filterConfig, tags: parseQueryToTags(query) });
    if (option.patch.tags) setQuery(option.patch.tags.join(' '));
    void executeSearchWithConfig(updated);
  };

  const hasCustomFilters =
    filterConfig.sortBy !== 'default' ||
    filterConfig.timeRange !== 'all' ||
    filterConfig.rating !== 'all' ||
    filterConfig.minScore !== undefined ||
    (filterConfig.cumstService && filterConfig.cumstService !== 'all') ||
    (filterConfig.cumstMediaType && filterConfig.cumstMediaType !== 'all') ||
    filterConfig.jumpToPage > 1;

  // Height-balanced masonry: each card goes to the currently shorter column.
  // Both columns end level; no dead space remains under the short column.
  const leftColumn: BooruPost[] = [];
  const rightColumn: BooruPost[] = [];
  const layoutMap = new Map<string, CardLayout>();
  {
    const colW = (SCREEN_WIDTH - 36) / 2; // same width as PostCard
    let leftH = 0;
    let rightH = 0;
    results.forEach((post) => {
      const ar = Math.max(0.6, Math.min(1.4, post.aspectRatio || 0.75)); // PostCard clamp'i
      const h = colW / ar + 12; // + kart marginBottom
      if (leftH <= rightH) {
        layoutMap.set(post.id, { y: leftH, h });
        leftColumn.push(post);
        leftH += h;
      } else {
        layoutMap.set(post.id, { y: rightH, h });
        rightColumn.push(post);
        rightH += h;
      }
    });
  }
  const layoutMapRef = useRef(layoutMap);
  layoutMapRef.current = layoutMap;

  const playableIds = React.useMemo(() => {
    const set = new Set<string>();
    results.forEach((p) => {
      if (getGridPreviewVideoCandidates(p, Platform.OS).length > 0) {
        set.add(p.id);
      }
    });
    return set;
  }, [results]);
  const playableIdsRef = useRef(playableIds);
  playableIdsRef.current = playableIds;
  const lastGridUpdateRef = useRef(0);
  const updateGridViewport = React.useCallback((immediate = false) => {
    const covered = header.occlusionRef.current;
    const offset = searchOffsetRef.current - gridTopRef.current + covered;
    const height = Math.max(0, viewportHeightRef.current - covered);
    updateVisible(layoutMapRef.current, offset, height);
    updateMounted(layoutMapRef.current, offset, height);
    updateFocused(layoutMapRef.current, offset, height, playableIdsRef.current, immediate);
  }, [updateVisible, updateMounted, updateFocused]);

  // Play the first screen's videos immediately when the results change
  useEffect(() => {
    updateGridViewport(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, header.height, header.enabled]);

  return (
    <View style={styles.container}>
      <View style={[styles.contentWrapper, { paddingTop: insets.top }]}>
        <ScrollAwayHeader controller={header} top={insets.top}>
        {/* Top Header with Active Source Badge (when search is not active) */}
        {!isSearchActive && (
          <View style={styles.topHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {onBackPress && (
                <TouchableOpacity
                  style={[styles.backButton, { position: 'relative', left: 0, top: 0, marginRight: 12 }]}
                  onPress={handleBack}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <ArrowLeft size={20} color="#FFFFFF" />
                </TouchableOpacity>
              )}
              <View>
                <Text style={styles.topHeaderTitle}>Search</Text>
                <Text style={styles.topHeaderSubtitle}>Discover tags or images</Text>
              </View>
            </View>

            {showSourcePicker && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Current source: ${activeSource.name}. Change source`}
                activeOpacity={0.8}
                onPress={() => {
                  Haptics.selectionAsync();
                  handleOpenSourcePicker();
                }}
                style={styles.sourcePill}
              >
                <Layers size={14} color={Colors.dark.primaryLight} />
                <Text style={styles.sourceText} numberOfLines={1}>
                  {activeSource.name.split(' ')[0]}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Search Bar & Filter Header */}
        <View style={styles.searchBarWrapper}>
          {(isSearchActive || Boolean(onBackPress)) && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={handleBack}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.7}
            >
              <ArrowLeft size={20} color="#FFFFFF" />
            </TouchableOpacity>
          )}

          <View style={styles.searchInputContainer}>
            <Search size={18} color={isInputFocused ? GOLD_ACCENT : Colors.dark.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search tags or creators..."
              placeholderTextColor={Colors.dark.textMuted}
              value={query}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => {
                setTimeout(() => setIsInputFocused(false), 250);
              }}
              onChangeText={(text) => {
                setQuery(text);
                if (!isInputFocused) setIsInputFocused(true);
              }}
              onSubmitEditing={() => {
                setIsInputFocused(false);
                setSuggestions([]);
                executeSearch(query, 'replace');
              }}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => {
                  setQuery('');
                  setSuggestions([]);
                  setIsInputFocused(false);
                  setFilterConfig((prev) => ({ ...prev, tags: [] }));
                }}
                style={styles.clearIcon}
              >
                <X size={16} color={Colors.dark.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Search Submit Button */}
          <TouchableOpacity
            style={styles.searchButton}
            onPress={() => {
              setIsInputFocused(false);
              setSuggestions([]);
              executeSearch(query, 'replace');
            }}
            activeOpacity={0.7}
          >
            <Search size={18} color="#FFFFFF" />
          </TouchableOpacity>

          {/* Filter Modal Trigger Button */}
          <TouchableOpacity
            style={[
              styles.filterButton,
              hasCustomFilters && styles.filterButtonActive,
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setIsFilterModalOpen(true);
            }}
            activeOpacity={0.7}
          >
            <SlidersHorizontal
              size={18}
              color={hasCustomFilters ? GOLD_ACCENT : '#FFFFFF'}
            />
            {hasCustomFilters && <View style={styles.activeFilterDot} />}
          </TouchableOpacity>
        </View>

        {/* Quick Filter Horizontal Scroll Bar */}
        <View style={styles.quickFiltersContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickFiltersContent}
          >
            {/* Active Source Quick Badge */}
            {showSourcePicker && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={`Current source: ${activeSource.name}. Change source`}
                style={styles.sourceQuickChip}
                onPress={() => {
                  Haptics.selectionAsync();
                  handleOpenSourcePicker();
                }}
                activeOpacity={0.7}
              >
                <Layers size={13} color={Colors.dark.primaryLight} />
                <Text style={styles.sourceQuickChipText} numberOfLines={1}>
                  {activeSource.name.split(' ')[0]}
                </Text>
              </TouchableOpacity>
            )}

            {/* Main Filter Modal Quick Chip */}
            <TouchableOpacity
              style={[styles.quickChip, hasCustomFilters && styles.quickChipActive]}
              onPress={() => setIsFilterModalOpen(true)}
              activeOpacity={0.7}
            >
              <SlidersHorizontal size={13} color={hasCustomFilters ? '#111216' : GOLD_ACCENT} />
              <Text style={[styles.quickChipText, hasCustomFilters && styles.quickChipTextActive]}>
                Filters {hasCustomFilters ? '• On' : ''}
              </Text>
            </TouchableOpacity>

            {quickOptions.map((option) => {
              const selected = isQuickFilterActive(option, filterConfig);
              return (
                <TouchableOpacity
                  key={option.id}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected }}
                  style={[styles.quickChip, selected && styles.quickChipActive]}
                  onPress={() => handleQuickPreset(option)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.quickChipText, selected && styles.quickChipTextActive]}>{option.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* HentaiHaven: spaced queries combine with AND, a quoted group searches a single genre */}
        {activeSource.type === 'hentaihaven' && (
          <View style={styles.syntaxHintBar}>
            <Text style={styles.syntaxHintText}>
              Genre: <Text style={styles.syntaxHintMono}>yuri</Text> · Multiple words:{' '}
              <Text style={styles.syntaxHintMono}>"big breasts" anal</Text> · Exclude:{' '}
              <Text style={styles.syntaxHintMono}>-tag</Text>
            </Text>
          </View>
        )}
        {/* RedGifs: the server does not do tag exclusion/inference; search via
          explicit niche and user prefixes, which this hint line shows. */}
        {activeSource.type === 'redgifs' && (
          <View style={styles.syntaxHintBar}>
            <Text style={styles.syntaxHintText}>
              Tag: <Text style={styles.syntaxHintMono}>tag</Text> · Niche:{' '}
              <Text style={styles.syntaxHintMono}>niche:id</Text> · User:{' '}
              <Text style={styles.syntaxHintMono}>user:name</Text> · Exclude:{' '}
              <Text style={styles.syntaxHintMono}>-tag</Text>
            </Text>
          </View>
        )}
        </ScrollAwayHeader>

        {/* Autocomplete Dropdown overlay - only when search input is focused */}
        {isInputFocused && suggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            <FlatList
              data={suggestions}
              keyExtractor={(item, index) => `search-sug-${item.name}-${index}`}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.suggestionRow}
                  onPress={() => handleSelectSuggestion(item.name, true, item.category)}
                >
                  <TagChip
                    name={item.name}
                    category={item.category}
                    count={item.postCount}
                    size="sm"
                    onPress={() => handleSelectSuggestion(item.name, true, item.category)}
                  />
                </TouchableOpacity>
              )}
            />
          </View>
        )}

        {/* Active Search Results or Suggestions/History */}
        {isSearchActive ? (
          loading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={Colors.dark.primary} />
              <Text style={styles.loadingText}>Searching results...</Text>
            </View>
          ) : searchError ? (
            <View style={styles.centerContainer}>
              <AlertCircle size={44} color={Colors.dark.danger} />
              <Text style={styles.noResultsTitle}>Search Error</Text>
              <Text style={styles.noResultsText}>{searchError}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => {
                  Haptics.selectionAsync();
                  executeSearchWithConfig(filterConfig);
                }}
                activeOpacity={0.7}
              >
                <RefreshCw size={15} color="#FFFFFF" />
                <Text style={styles.retryButtonText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : results.length === 0 ? (
            <View style={styles.centerContainer}>
              <ImageIcon size={48} color={Colors.dark.textMuted} />
              <Text style={styles.noResultsTitle}>No Results Found</Text>
              <Text style={styles.noResultsText}>
                No images matched the selected filters and tags.
              </Text>
            </View>
          ) : (
            <ScrollView
              ref={resultsScrollRef}
              style={styles.resultsScroll}
              contentContainerStyle={[styles.resultsContent, header.enabled && { paddingTop: header.height + 12 }]}
              showsVerticalScrollIndicator={false}
              onScroll={(event) => {
                const changed = header.onScroll(event);
                const { nativeEvent } = event;
                const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
                searchOffsetRef.current = contentOffset.y;
                viewportHeightRef.current = layoutMeasurement.height;
                const now = Date.now();
                if (changed || now - lastGridUpdateRef.current >= 150) {
                  lastGridUpdateRef.current = now;
                  updateGridViewport(changed);
                }
                if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 900) {
                  loadMoreResults();
                }
              }}
              onMomentumScrollEnd={() => updateGridViewport(true)}
              onScrollEndDrag={() => updateGridViewport(true)}
              onLayout={({ nativeEvent }) => { viewportHeightRef.current = nativeEvent.layout.height; updateGridViewport(true); }}
              scrollEventThrottle={32}
            >
              {/* Active Filter Info Banner */}
              <View style={styles.activeTagBanner}>
                <View style={styles.activeTagInfo}>
                  {filterConfig.tags.length > 0 ? (
                    <Text style={styles.activeTagName}>
                      #{filterConfig.tags.join(' #')}
                    </Text>
                  ) : (
                    <Text style={styles.activeTagName}>
                      All Posts
                    </Text>
                  )}
                  <Text style={styles.activeTagCount}>({results.length}+ results)</Text>
                </View>

                {hasCustomFilters && (
                  <View style={styles.activeFiltersPillRow}>
                    {filterConfig.sortBy === 'score' && (
                      <View style={styles.smallFilterPill}>
                        <Text style={styles.smallFilterPillText}>
                          Popular ({filterConfig.timeRange})
                        </Text>
                      </View>
                    )}
                    {filterConfig.rating !== 'all' && (
                      <View style={styles.smallFilterPill}>
                        <Text style={styles.smallFilterPillText}>
                          🛡️ {filterConfig.rating}
                        </Text>
                      </View>
                    )}
                    {filterConfig.minScore && (
                      <View style={styles.smallFilterPill}>
                        <Text style={styles.smallFilterPillText}>
                          ⭐ {filterConfig.minScore}+
                        </Text>
                      </View>
                    )}
                    {filterConfig.jumpToPage > 1 && (
                      <View style={styles.smallFilterPill}>
                        <Text style={styles.smallFilterPillText}>
                          Page {filterConfig.jumpToPage}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>

              {/* 2-Column Masonry Grid */}
              <View style={styles.gridContainer} onLayout={({ nativeEvent }) => { gridTopRef.current = nativeEvent.layout.y; updateGridViewport(true); }}>
                <View style={styles.column}>
                  {leftColumn.map((post) =>
                    mountedIds && !mountedIds.has(post.id) ? (
                      <View
                        key={`search-${post.id}`}
                        style={{ height: layoutMap.get(post.id)?.h ?? 320 }}
                      />
                    ) : (
                      <PostCard
                        key={`search-${post.id}`}
                        post={post}
                        favoriteIds={favoriteIds}
                        column="left"
                        screenActive={isFocused && mediaAllowed && !isFilterModalOpen && !isSourceSheetOpen}
                        videoActive={focusedIds.has(post.id)}
                        onScreen={visibleIds.has(post.id)}
                        onPress={handleCardPress}
                      />
                    )
                  )}
                </View>
                <View style={styles.column}>
                  {rightColumn.map((post) =>
                    mountedIds && !mountedIds.has(post.id) ? (
                      <View
                        key={`search-${post.id}`}
                        style={{ height: layoutMap.get(post.id)?.h ?? 320 }}
                      />
                    ) : (
                      <PostCard
                        key={`search-${post.id}`}
                        post={post}
                        favoriteIds={favoriteIds}
                        column="right"
                        screenActive={isFocused && mediaAllowed && !isFilterModalOpen && !isSourceSheetOpen}
                        videoActive={focusedIds.has(post.id)}
                        onScreen={visibleIds.has(post.id)}
                        onPress={handleCardPress}
                      />
                    )
                  )}
                </View>
              </View>

              {loadingMore && (
                <View style={styles.footerLoader}>
                  <ActivityIndicator size="small" color={Colors.dark.primary} />
                  <Text style={styles.footerText}>Loading more...</Text>
                </View>
              )}
            </ScrollView>
          )
        ) : (
          <ScrollView
            style={styles.exploreScroll}
            contentContainerStyle={styles.exploreContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Recent History */}
            {history.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleWithIcon}>
                    <Clock size={16} color={Colors.dark.textSecondary} />
                    <Text style={styles.sectionTitle}>Recent Searches</Text>
                  </View>
                  <TouchableOpacity onPress={handleClearHistory}>
                    <Text style={styles.clearText}>Clear</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.tagWrap}>
                  {history.map((tag, idx) => (
                    <TagChip
                      key={`hist-${tag}-${idx}`}
                      name={tag}
                      category="general"
                      onPress={() => executeSearch(tag)}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Favorite Pinned Tags */}
            {favoriteTags.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleWithIcon}>
                    <Pin size={16} color={GOLD_ACCENT} />
                    <Text style={styles.sectionTitle}>Favorite Tags</Text>
                  </View>
                </View>
                <View style={styles.tagWrap}>
                  {favoriteTags.map((tag, idx) => (
                    <TagChip
                      key={`fav-search-tag-${tag}-${idx}`}
                      name={tag}
                      category="meta"
                      onPress={() => executeSearch(tag)}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* RedGifs Niches (Categories) */}
            {activeSource.type === 'redgifs' && (niches.length > 0 || nichesLoading) && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleWithIcon}>
                    <Layers size={16} color={GOLD_ACCENT} />
                    <Text style={styles.sectionTitle}>Categories (Niches)</Text>
                  </View>
                  {nichesLoading && <ActivityIndicator size="small" color={Colors.dark.primary} />}
                </View>
                <View style={styles.tagWrap}>
                  {niches.map((niche) => (
                    <TagChip
                      key={`niche-${niche.id}`}
                      name={niche.name}
                      category="general"
                      count={niche.gifCount}
                      onPress={() => executeSearch(`niche:${niche.id}`)}
                    />
                  ))}
                </View>
              </View>
            )}

            {/* Popular Trending Tags */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleWithIcon}>
                  <Flame size={16} color="#FF7B72" />
                  <Text style={styles.sectionTitle}>Popular Tags</Text>
                </View>
              </View>
              <View style={styles.tagWrap}>
                {POPULAR_TAGS.map((tag, idx) => (
                  <TagChip
                    key={`pop-${tag}-${idx}`}
                    name={tag}
                    category="general"
                    onPress={() => executeSearch(tag)}
                  />
                ))}
              </View>
            </View>
          </ScrollView>
        )}
      </View>

      {/* Filter Modal (Full screen matching screenshots) */}
      <SearchFilterModal
        visible={isFilterModalOpen}
        filterConfig={filterConfig}
        activeSource={activeSource}
        onSelectSource={handleSelectSource}
        onClose={() => setIsFilterModalOpen(false)}
        onApply={handleApplyFilterModal}
      />

      <SourceSheet
        visible={isSourceSheetOpen}
        activeSource={activeSource}
        onSelectSource={handleSelectSource}
        onClose={() => setIsSourceSheetOpen(false)}
        onManage={handleManageSources}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.dark.background,
  },
  contentWrapper: {
    flex: 1,
  },
  searchBarWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  backButton: {
    width: 42,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#181A22',
    borderWidth: 1,
    borderColor: '#292D3B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181A22',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 44,
    borderWidth: 1,
    borderColor: '#292D3B',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    color: Colors.dark.text,
    fontSize: 14,
  },
  clearIcon: {
    padding: 4,
  },
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#181A22',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#292D3B',
    position: 'relative',
  },
  searchButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonActive: {
    borderColor: GOLD_ACCENT,
    backgroundColor: 'rgba(245, 166, 35, 0.15)',
  },
  activeFilterDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: GOLD_ACCENT,
  },
  quickFiltersContainer: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.07)',
    paddingBottom: 10,
  },
  syntaxHintBar: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  syntaxHintText: {
    fontSize: 11,
    color: Colors.dark.textMuted,
  },
  syntaxHintMono: {
    color: GOLD_ACCENT,
    fontWeight: '700',
  },
  quickFiltersContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  quickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181A22',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#292D3B',
    gap: 6,
  },
  quickChipActive: {
    backgroundColor: GOLD_ACCENT,
    borderColor: GOLD_ACCENT,
  },
  quickChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  quickChipTextActive: {
    color: '#111216',
    fontWeight: '700',
  },
  suggestionsContainer: {
    position: 'absolute',
    top: 110,
    left: 16,
    right: 16,
    maxHeight: 250,
    borderRadius: 16,
    backgroundColor: '#1A1C26',
    borderWidth: 1,
    borderColor: '#2D3242',
    zIndex: 100,
    padding: 8,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 14,
    elevation: 12,
  },
  suggestionRow: {
    paddingVertical: 4,
  },
  exploreScroll: {
    flex: 1,
  },
  exploreContent: {
    padding: 16,
  },
  section: {
    marginBottom: 26,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitleWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionTitle: {
    color: Colors.dark.text,
    fontSize: 15,
    fontWeight: '700',
  },
  clearText: {
    color: Colors.dark.primaryLight,
    fontSize: 13,
    fontWeight: '600',
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  activeTagBanner: {
    marginBottom: 14,
    paddingHorizontal: 4,
    gap: 6,
  },
  activeTagInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activeTagName: {
    color: Colors.dark.primaryLight,
    fontSize: 16,
    fontWeight: '800',
  },
  activeTagCount: {
    color: Colors.dark.textMuted,
    fontSize: 12,
  },
  activeFiltersPillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  smallFilterPill: {
    backgroundColor: 'rgba(245, 166, 35, 0.12)',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.35)',
  },
  smallFilterPillText: {
    fontSize: 11,
    color: GOLD_ACCENT,
    fontWeight: '600',
  },
  resultsScroll: {
    flex: 1,
  },
  resultsContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 30,
  },
  gridContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  column: {
    width: (SCREEN_WIDTH - 36) / 2,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: Colors.dark.textMuted,
  },
  noResultsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
    marginTop: 14,
  },
  noResultsText: {
    fontSize: 13,
    color: Colors.dark.textMuted,
    textAlign: 'center',
    marginTop: 6,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginTop: 16,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  footerLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  footerText: {
    color: Colors.dark.textMuted,
    fontSize: 13,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  topHeaderTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.dark.text,
    letterSpacing: -0.5,
  },
  topHeaderSubtitle: {
    fontSize: 12,
    color: Colors.dark.textMuted,
    marginTop: 2,
  },
  sourcePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: '#181A22',
    borderWidth: 1,
    borderColor: '#292D3B',
  },
  sourceText: {
    color: Colors.dark.text,
    fontSize: 11,
    fontWeight: '700',
  },
  sourceQuickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181A22',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.4)',
    gap: 5,
  },
  sourceQuickChipText: {
    fontSize: 11,
    fontWeight: '700',
    color: GOLD_ACCENT,
    maxWidth: 90,
  },
});


