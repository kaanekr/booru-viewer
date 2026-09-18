import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Keyboard,
  ScrollView,
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
  Calendar,
  Sparkles,
  ShieldCheck,
  Star,
  Pin,
  Layers,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { booruApi } from '../services/booruApi';
import { useNavigation, type RouteProp } from '@react-navigation/native';
import {
  BooruPost,
  BooruSource,
  BooruTagSuggestion,
  SearchFilterConfig,
  DEFAULT_FILTER_CONFIG,
} from '../types/booru';
import type { TabParamList, SearchMode } from '../navigation/types';
import { StorageService } from '../services/storage';
import { PostCard } from '../components/PostCard';
import { TagChip } from '../components/TagChip';
import { pushViewer } from '../navigation/rootNavigation';
import { SearchFilterModal } from '../components/SearchFilterModal';
import { Colors } from '../theme/colors';
import { getMediaHeaders } from '../utils/media';
import { useSource } from '../context/SourceContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
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
  const { activeSource: contextSource } = useSource();
  const activeSource = propSource ?? contextSource;
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

  // Source Tracking & Race Condition Prevention Refs
  const lastActiveSourceIdRef = useRef(activeSource.id);
  const searchRequestIdRef = useRef(0);

  const routeParams = route?.params;
  const effectiveTag = initialTag ?? routeParams?.tag;
  const effectiveMode = initialMode ?? routeParams?.mode ?? 'replace';

  const handleOpenSourcePicker = () => {
    if (onOpenSourcePicker) {
      onOpenSourcePicker();
    } else if (navigation?.navigate) {
      navigation.navigate('Settings');
    }
  };

  const showSourcePicker = Boolean(onOpenSourcePicker) || (!onBackPress && Boolean(navigation?.navigate));

  useEffect(() => {
    StorageService.getSearchHistory().then(setHistory);
    StorageService.getFavoriteTags().then(setFavoriteTags);
  }, [isSearchActive]);

  // Stable key for initialFilter/initialTag to prevent re-search loops on parent re-renders
  const lastInitialKeyRef = useRef<string>('');
  const initialFilterKey = initialFilter
    ? `${JSON.stringify(initialFilter.tags)}|${initialFilter.rating}|${initialFilter.sortBy}|${initialFilter.timeRange}|${initialFilter.minScore ?? ''}|${initialFilter.cumstService ?? ''}|${initialFilter.cumstMediaType ?? ''}|${initialFilter.jumpToPage}`
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
    if (!isInputFocused || !filterConfig.autocompleteFromServer || !query || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const currentSourceId = activeSource.id;
    const timer = setTimeout(async () => {
      const cleanQ = query.trim().replace(/^-+/, '');
      if (cleanQ.length < 2) {
        setSuggestions([]);
        return;
      }
      try {
        const list = await booruApi.searchTags(cleanQ);
        if (currentSourceId === lastActiveSourceIdRef.current) {
          setSuggestions(list);
        }
      } catch (e) {
        if (currentSourceId === lastActiveSourceIdRef.current) {
          setSuggestions([]);
        }
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, isInputFocused, filterConfig.autocompleteFromServer, activeSource.id]);

  const executeSearchWithConfig = async (config: SearchFilterConfig) => {
    Keyboard.dismiss();
    setIsInputFocused(false);
    Haptics.selectionAsync();
    setSuggestions([]);
    setIsSearchActive(true);
    setLoading(true);

    const requestId = ++searchRequestIdRef.current;
    const expectedSourceId = activeSource.id;

    const startPage = config.jumpToPage > 1 ? config.jumpToPage : 1;
    setPage(startPage);

    // Save full query to history (multi-tag searches stay as one bubble)
    if (config.tags.length > 0) {
      await StorageService.addSearchHistory(config.tags.join(' '));
      StorageService.getSearchHistory().then(setHistory);
    }

    try {
      const posts = await booruApi.fetchPostsWithFilter(config, startPage, 24);
      // Guard: Ignore response if source changed or newer search request was triggered
      if (requestId !== searchRequestIdRef.current || expectedSourceId !== lastActiveSourceIdRef.current) {
        return;
      }

      posts.slice(0, 10).forEach((p) => {
        const u = p.previewUrl || p.sampleUrl;
        if (u) Image.prefetch(u, { headers: getMediaHeaders(u) });
      });
      setResults(posts);
    } catch (e) {
      if (requestId !== searchRequestIdRef.current || expectedSourceId !== lastActiveSourceIdRef.current) {
        return;
      }
      console.warn('Search with config error:', e);
      setResults([]);
    } finally {
      if (requestId === searchRequestIdRef.current && expectedSourceId === lastActiveSourceIdRef.current) {
        setLoading(false);
      }
    }
  };

  const parseQueryToTags = (raw: string): string[] => {
    return raw
      .trim()
      .split(/\s+/)
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
    if (incomingTags.length === 0) return;

    let updatedTags: string[];

    if (mode === 'add') {
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
    if (newConfig.tags.length > 0) {
      setQuery(newConfig.tags.join(' '));
    }
    executeSearchWithConfig(newConfig);
  };

  const loadMoreResults = async () => {
    if (!isSearchActive || loadingMore || loading) return;
    const requestId = searchRequestIdRef.current;
    const expectedSourceId = activeSource.id;

    setLoadingMore(true);
    const nextPage = page + 1;
    setPage(nextPage);

    try {
      const newPosts = await booruApi.fetchPostsWithFilter(filterConfig, nextPage, 24);
      if (requestId !== searchRequestIdRef.current || expectedSourceId !== lastActiveSourceIdRef.current) {
        return;
      }

      newPosts.slice(0, 8).forEach((p) => {
        const u = p.previewUrl || p.sampleUrl;
        if (u) Image.prefetch(u, { headers: getMediaHeaders(u) });
      });
      setResults((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const unique = newPosts.filter((p) => !existingIds.has(p.id));
        return [...prev, ...unique];
      });
    } catch (e) {
      if (requestId !== searchRequestIdRef.current || expectedSourceId !== lastActiveSourceIdRef.current) {
        return;
      }
      console.warn('Load more search error:', e);
    } finally {
      if (requestId === searchRequestIdRef.current && expectedSourceId === lastActiveSourceIdRef.current) {
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

  const resultsScrollRef = useRef<ScrollView>(null);

  // Quick preset toggles
  const handleQuickPreset = (
    preset:
      | 'score_day'
      | 'score_week'
      | 'score_month'
      | 'score_all'
      | 'safe_only'
      | 'score_50'
      | 'cumst_videos'
      | 'cumst_onlyfans'
      | 'cumst_fansly'
  ) => {
    Haptics.selectionAsync();
    let updated: SearchFilterConfig = { ...filterConfig };
    if (preset === 'score_day') {
      updated.sortBy = updated.sortBy === 'score' && updated.timeRange === '1d' ? 'default' : 'score';
      updated.timeRange = '1d';
    } else if (preset === 'score_week') {
      updated.sortBy = updated.sortBy === 'score' && updated.timeRange === '1w' ? 'default' : 'score';
      updated.timeRange = '1w';
    } else if (preset === 'score_month') {
      updated.sortBy = updated.sortBy === 'score' && updated.timeRange === '1m' ? 'default' : 'score';
      updated.timeRange = '1m';
    } else if (preset === 'score_all') {
      updated.sortBy = updated.sortBy === 'score' && updated.timeRange === 'all' ? 'default' : 'score';
      updated.timeRange = 'all';
    } else if (preset === 'safe_only') {
      updated.rating = updated.rating === 'safe' ? 'all' : 'safe';
    } else if (preset === 'score_50') {
      updated.minScore = updated.minScore === 50 ? undefined : 50;
    } else if (preset === 'cumst_videos') {
      updated.cumstMediaType = updated.cumstMediaType === 'videos' ? 'all' : 'videos';
    } else if (preset === 'cumst_onlyfans') {
      updated.cumstService = updated.cumstService === 'onlyfans' ? 'all' : 'onlyfans';
    } else if (preset === 'cumst_fansly') {
      updated.cumstService = updated.cumstService === 'fansly' ? 'all' : 'fansly';
    }

    setFilterConfig(updated);
    if (isSearchActive || updated.tags.length > 0) {
      executeSearchWithConfig(updated);
    }
  };

  const hasCustomFilters =
    filterConfig.sortBy !== 'default' ||
    filterConfig.timeRange !== 'all' ||
    filterConfig.rating !== 'all' ||
    filterConfig.minScore !== undefined ||
    (filterConfig.cumstService && filterConfig.cumstService !== 'all') ||
    (filterConfig.cumstMediaType && filterConfig.cumstMediaType !== 'all') ||
    filterConfig.jumpToPage > 1;

  // Masonry distribution for results
  const leftColumn: BooruPost[] = [];
  const rightColumn: BooruPost[] = [];
  results.forEach((post, index) => {
    if (index % 2 === 0) {
      leftColumn.push(post);
    } else {
      rightColumn.push(post);
    }
  });

  return (
    <View style={styles.container}>
      <View style={[styles.contentWrapper, { paddingTop: insets.top }]}>
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
                <Text style={styles.topHeaderTitle}>Arama</Text>
                <Text style={styles.topHeaderSubtitle}>Etiket veya görsel keşfet</Text>
              </View>
            </View>

            {showSourcePicker && (
              <TouchableOpacity
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
              placeholder="Etiket veya içerik üretici ara..."
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
                Filtreler {hasCustomFilters ? '• Açık' : ''}
              </Text>
            </TouchableOpacity>

            {activeSource.type === 'cumst' ? (
              <>
                {/* Cumst Quick Day Leaderboard */}
                <TouchableOpacity
                  style={[
                    styles.quickChip,
                    filterConfig.sortBy === 'score' &&
                      filterConfig.timeRange === '1d' &&
                      styles.quickChipActive,
                  ]}
                  onPress={() => handleQuickPreset('score_day')}
                  activeOpacity={0.7}
                >
                  <Flame
                    size={13}
                    color={
                      filterConfig.sortBy === 'score' && filterConfig.timeRange === '1d'
                        ? '#111216'
                        : '#FF7B72'
                    }
                  />
                  <Text
                    style={[
                      styles.quickChipText,
                      filterConfig.sortBy === 'score' &&
                        filterConfig.timeRange === '1d' &&
                        styles.quickChipTextActive,
                    ]}
                  >
                    Günün Lideri
                  </Text>
                </TouchableOpacity>

                {/* Cumst Quick Week Leaderboard */}
                <TouchableOpacity
                  style={[
                    styles.quickChip,
                    filterConfig.sortBy === 'score' &&
                      filterConfig.timeRange === '1w' &&
                      styles.quickChipActive,
                  ]}
                  onPress={() => handleQuickPreset('score_week')}
                  activeOpacity={0.7}
                >
                  <Calendar
                    size={13}
                    color={
                      filterConfig.sortBy === 'score' && filterConfig.timeRange === '1w'
                        ? '#111216'
                        : '#58A6FF'
                    }
                  />
                  <Text
                    style={[
                      styles.quickChipText,
                      filterConfig.sortBy === 'score' &&
                        filterConfig.timeRange === '1w' &&
                        styles.quickChipTextActive,
                    ]}
                  >
                    Haftanın Lideri
                  </Text>
                </TouchableOpacity>

                {/* Cumst Quick Month Leaderboard */}
                <TouchableOpacity
                  style={[
                    styles.quickChip,
                    filterConfig.sortBy === 'score' &&
                      filterConfig.timeRange === '1m' &&
                      styles.quickChipActive,
                  ]}
                  onPress={() => handleQuickPreset('score_month')}
                  activeOpacity={0.7}
                >
                  <Star
                    size={13}
                    color={
                      filterConfig.sortBy === 'score' && filterConfig.timeRange === '1m'
                        ? '#111216'
                        : '#FCC419'
                    }
                  />
                  <Text
                    style={[
                      styles.quickChipText,
                      filterConfig.sortBy === 'score' &&
                        filterConfig.timeRange === '1m' &&
                        styles.quickChipTextActive,
                    ]}
                  >
                    Ayın Lideri
                  </Text>
                </TouchableOpacity>

                {/* Cumst Quick Videos Only */}
                <TouchableOpacity
                  style={[
                    styles.quickChip,
                    filterConfig.cumstMediaType === 'videos' && styles.quickChipActive,
                  ]}
                  onPress={() => handleQuickPreset('cumst_videos')}
                  activeOpacity={0.7}
                >
                  <Sparkles
                    size={13}
                    color={filterConfig.cumstMediaType === 'videos' ? '#111216' : '#A371F7'}
                  />
                  <Text
                    style={[
                      styles.quickChipText,
                      filterConfig.cumstMediaType === 'videos' && styles.quickChipTextActive,
                    ]}
                  >
                    Videolar
                  </Text>
                </TouchableOpacity>

                {/* Cumst Quick OnlyFans */}
                <TouchableOpacity
                  style={[
                    styles.quickChip,
                    filterConfig.cumstService === 'onlyfans' && styles.quickChipActive,
                  ]}
                  onPress={() => handleQuickPreset('cumst_onlyfans')}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.quickChipText,
                      filterConfig.cumstService === 'onlyfans' && styles.quickChipTextActive,
                    ]}
                  >
                    OnlyFans
                  </Text>
                </TouchableOpacity>

                {/* Cumst Quick Fansly */}
                <TouchableOpacity
                  style={[
                    styles.quickChip,
                    filterConfig.cumstService === 'fansly' && styles.quickChipActive,
                  ]}
                  onPress={() => handleQuickPreset('cumst_fansly')}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.quickChipText,
                      filterConfig.cumstService === 'fansly' && styles.quickChipTextActive,
                    ]}
                  >
                    Fansly
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                {/* Quick Popularity: This Week */}
                <TouchableOpacity
                  style={[
                    styles.quickChip,
                    filterConfig.sortBy === 'score' &&
                      filterConfig.timeRange === '1w' &&
                      styles.quickChipActive,
                  ]}
                  onPress={() => handleQuickPreset('score_week')}
                  activeOpacity={0.7}
                >
                  <Flame
                    size={13}
                    color={
                      filterConfig.sortBy === 'score' && filterConfig.timeRange === '1w'
                        ? '#111216'
                        : '#FF7B72'
                    }
                  />
                  <Text
                    style={[
                      styles.quickChipText,
                      filterConfig.sortBy === 'score' &&
                        filterConfig.timeRange === '1w' &&
                        styles.quickChipTextActive,
                    ]}
                  >
                    Popüler (Hafta)
                  </Text>
                </TouchableOpacity>

                {/* Quick Popularity: This Month */}
                <TouchableOpacity
                  style={[
                    styles.quickChip,
                    filterConfig.sortBy === 'score' &&
                      filterConfig.timeRange === '1m' &&
                      styles.quickChipActive,
                  ]}
                  onPress={() => handleQuickPreset('score_month')}
                  activeOpacity={0.7}
                >
                  <Calendar
                    size={13}
                    color={
                      filterConfig.sortBy === 'score' && filterConfig.timeRange === '1m'
                        ? '#111216'
                        : '#58A6FF'
                    }
                  />
                  <Text
                    style={[
                      styles.quickChipText,
                      filterConfig.sortBy === 'score' &&
                        filterConfig.timeRange === '1m' &&
                        styles.quickChipTextActive,
                    ]}
                  >
                    Popüler (Ay)
                  </Text>
                </TouchableOpacity>

                {/* Quick Rating: Safe Only */}
                <TouchableOpacity
                  style={[
                    styles.quickChip,
                    filterConfig.rating === 'safe' && styles.quickChipActive,
                  ]}
                  onPress={() => handleQuickPreset('safe_only')}
                  activeOpacity={0.7}
                >
                  <ShieldCheck
                    size={13}
                    color={filterConfig.rating === 'safe' ? '#111216' : '#51CF66'}
                  />
                  <Text
                    style={[
                      styles.quickChipText,
                      filterConfig.rating === 'safe' && styles.quickChipTextActive,
                    ]}
                  >
                    Safe (Güvenli)
                  </Text>
                </TouchableOpacity>

                {/* Quick Min Score: 50+ */}
                <TouchableOpacity
                  style={[
                    styles.quickChip,
                    filterConfig.minScore === 50 && styles.quickChipActive,
                  ]}
                  onPress={() => handleQuickPreset('score_50')}
                  activeOpacity={0.7}
                >
                  <Star
                    size={13}
                    color={filterConfig.minScore === 50 ? '#111216' : '#FCC419'}
                  />
                  <Text
                    style={[
                      styles.quickChipText,
                      filterConfig.minScore === 50 && styles.quickChipTextActive,
                    ]}
                  >
                    50+ Puan
                  </Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>

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
                  onPress={() => executeSearch(item.name)}
                >
                  <TagChip
                    name={item.name}
                    category={item.category}
                    count={item.postCount}
                    size="sm"
                    onPress={() => executeSearch(item.name)}
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
              <Text style={styles.loadingText}>Sonuçlar aranıyor...</Text>
            </View>
          ) : results.length === 0 ? (
            <View style={styles.centerContainer}>
              <ImageIcon size={48} color={Colors.dark.textMuted} />
              <Text style={styles.noResultsTitle}>Sonuç Bulunamadı</Text>
              <Text style={styles.noResultsText}>
                Seçilen filtre ve etiketlerle eşleşen görsel bulunamadı.
              </Text>
            </View>
          ) : (
            <ScrollView
              ref={resultsScrollRef}
              style={styles.resultsScroll}
              contentContainerStyle={styles.resultsContent}
              showsVerticalScrollIndicator={false}
              onScroll={({ nativeEvent }) => {
                const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
                if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 400) {
                  loadMoreResults();
                }
              }}
              scrollEventThrottle={300}
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
                      Tüm Gönderiler
                    </Text>
                  )}
                  <Text style={styles.activeTagCount}>({results.length}+ sonuç)</Text>
                </View>

                {hasCustomFilters && (
                  <View style={styles.activeFiltersPillRow}>
                    {filterConfig.sortBy === 'score' && (
                      <View style={styles.smallFilterPill}>
                        <Text style={styles.smallFilterPillText}>
                          🔥 Popüler ({filterConfig.timeRange})
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
                  </View>
                )}
              </View>

              {/* Masonry Post Grid */}
              <View style={styles.gridContainer}>
                <View style={styles.column}>
                  {leftColumn.map((post, index) => (
                    <PostCard
                      key={`left-${post.id}-${index}`}
                      post={post}
                      onPress={(p) => {
                        const idx = results.findIndex((item) => item.id === p.id);
                        if (idx >= 0) {
                          pushViewer(results, idx, filterConfig.tags, filterConfig);
                        }
                      }}
                    />
                  ))}
                </View>
                <View style={styles.column}>
                  {rightColumn.map((post, index) => (
                    <PostCard
                      key={`right-${post.id}-${index}`}
                      post={post}
                      onPress={(p) => {
                        const idx = results.findIndex((item) => item.id === p.id);
                        if (idx >= 0) {
                          pushViewer(results, idx, filterConfig.tags, filterConfig);
                        }
                      }}
                    />
                  ))}
                </View>
              </View>

              {loadingMore && (
                <View style={styles.footerLoader}>
                  <ActivityIndicator size="small" color={Colors.dark.primary} />
                  <Text style={styles.footerText}>Daha fazla yükleniyor...</Text>
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
                    <Text style={styles.sectionTitle}>Son Aramalar</Text>
                  </View>
                  <TouchableOpacity onPress={handleClearHistory}>
                    <Text style={styles.clearText}>Temizle</Text>
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

            {/* Favorite Pinned Tags (Tag Favorileri) */}
            {favoriteTags.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionTitleWithIcon}>
                    <Pin size={16} color={GOLD_ACCENT} />
                    <Text style={styles.sectionTitle}>Favori Etiketler</Text>
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

            {/* Popular Trending Tags */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View style={styles.sectionTitleWithIcon}>
                  <Flame size={16} color="#FF7B72" />
                  <Text style={styles.sectionTitle}>Popüler Etiketler</Text>
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
        onClose={() => setIsFilterModalOpen(false)}
        onApply={handleApplyFilterModal}
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
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#181A22',
    borderWidth: 1,
    borderColor: '#292D3B',
  },
  sourceText: {
    color: Colors.dark.text,
    fontSize: 12,
    fontWeight: '700',
  },
  sourceQuickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181A22',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.4)',
    gap: 6,
  },
  sourceQuickChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: GOLD_ACCENT,
    maxWidth: 90,
  },
});


