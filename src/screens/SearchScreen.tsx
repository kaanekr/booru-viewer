import React, { useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Keyboard,
  PanResponder,
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
import {
  BooruPost,
  BooruSource,
  BooruTagSuggestion,
  SearchFilterConfig,
  DEFAULT_FILTER_CONFIG,
} from '../types/booru';
import { StorageService } from '../services/storage';
import { PostCard } from '../components/PostCard';
import { TagChip } from '../components/TagChip';
import { pushViewer, pushSearchDetail } from '../navigation/rootNavigation';
import { SearchFilterModal } from '../components/SearchFilterModal';
import { Colors } from '../theme/colors';
import { getMediaHeaders } from '../utils/media';

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
  initialTag?: string;
  initialMode?: 'replace' | 'add' | 'exclude';
  initialFilter?: SearchFilterConfig;
  activeSource: BooruSource;
  onClearInitialTag?: () => void;
  onOpenSourcePicker?: () => void;
  onBackPress?: () => void;
}

interface SearchHistoryEntry {
  filterConfig: SearchFilterConfig;
  results: BooruPost[];
  query: string;
  page: number;
  selectedPostIndex: number | null;
}

export const SearchScreen: React.FC<SearchScreenProps> = ({
  initialTag,
  initialMode,
  initialFilter,
  activeSource,
  onClearInitialTag,
  onOpenSourcePicker,
  onBackPress,
}) => {
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
  const [selectedPostIndex, setSelectedPostIndex] = useState<number | null>(null);

  // Browser-like History Stack for deep tag navigation and returning to viewed posts
  const [navHistory, setNavHistory] = useState<SearchHistoryEntry[]>([]);
  // Görüntüleyici açılış animasyonu: normal açışta kayarak, geri dönüşte anında.
  const [viewerEnterAnim, setViewerEnterAnim] = useState<'slide' | 'none'>('slide');
  // Geri animasyonu boyunca underlay'in hedef karede donmuş kalması için:
  // pop anında previousState bir derinliğe kayar, dondurulmuş hedef korunur.
  const [backPreview, setBackPreview] = useState<SearchHistoryEntry | null>(null);
  const navHistoryRef = useRef<SearchHistoryEntry[]>([]);
  navHistoryRef.current = navHistory;

  // Source Tracking & Race Condition Prevention Refs
  const lastActiveSourceIdRef = useRef(activeSource.id);
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    StorageService.getSearchHistory().then(setHistory);
    StorageService.getFavoriteTags().then(setFavoriteTags);
  }, [isSearchActive]);

  useEffect(() => {
    if (initialFilter) {
      setFilterConfig(initialFilter);
      executeSearchWithConfig(initialFilter);
    } else if (initialTag) {
      executeSearch(initialTag, initialMode || 'replace');
      if (onClearInitialTag) onClearInitialTag();
    }
  }, [initialFilter, initialTag, initialMode]);

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
      setSelectedPostIndex(null);
      setNavHistory([]);
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

    // Save tags to history
    if (config.tags.length > 0) {
      for (const t of config.tags) {
        await StorageService.addSearchHistory(t);
      }
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
    mode: 'replace' | 'add' | 'exclude' = 'replace',
    shouldPushHistory: boolean = false,
    originPostIndex?: number | null
  ) => {
    Keyboard.dismiss();
    setIsInputFocused(false);
    setSuggestions([]);

    const incomingTags = parseQueryToTags(tagOrQuery);
    if (incomingTags.length === 0) return;

    // Push previous state to browser navigation stack if transitioning.
    // Hiyerarşik geri dönüş: viewer'dan "add to search" ile gelindiyse
    // çıkılan içeriğin index'i saklanır, geri gidince önce o içeriğe dönülür.
    if (shouldPushHistory || (isSearchActive && results.length > 0)) {
      const originIdx =
        originPostIndex !== undefined && originPostIndex !== null
          ? originPostIndex
          : selectedPostIndex;
      setNavHistory((prev) => [
        ...prev,
        {
          filterConfig: { ...filterConfig },
          results: [...results],
          query,
          page,
          selectedPostIndex: typeof originIdx === 'number' ? originIdx : null,
        },
      ]);
    }

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

  const handleGoBack = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (navHistory.length > 0) {
      // Pop last history state and restore exactly as user left it.
      // Görüntüleyici animasyonsuz geri gelir: sağdan kayma "ileri"
      // hissi verdiği için enterAnimation kapatılır.
      const lastEntry = navHistory[navHistory.length - 1];
      setNavHistory((prev) => prev.slice(0, -1));
      // Underlay'i hedef karede dondur: pop anında previousState bir
      // derinliğe kayar, backPreview animasyon bitene kadar hedefi korur.
      setBackPreview(lastEntry);

      setViewerEnterAnim('none');
      // Foreground commit anında hâlâ ekran dışında (translateX = WIDTH):
      // önce kaydırma konumunu sıfırla, sonra state'i takas et. Böylece
      // underlay (her zaman liste başı) ile final karesi aynı offset'te olur.
      // Hiyerarşik geri dönüş: kayıtlı viewer index'i geri açılır, önce
      // çıkılan içeriğe dönülür; underlay aynı içeriğin snapshot'ını gösterir.
      resultsScrollRef.current?.scrollTo({ y: 0, animated: false });
      const targetIndex =
        typeof lastEntry.selectedPostIndex === 'number' &&
        lastEntry.results[lastEntry.selectedPostIndex]
          ? lastEntry.selectedPostIndex
          : null;
      setFilterConfig(lastEntry.filterConfig);
      setResults(lastEntry.results);
      setQuery(lastEntry.query);
      setPage(lastEntry.page);
      setIsSearchActive(true);
      setSelectedPostIndex(targetIndex);
    } else {
      setSelectedPostIndex(null);
      handleExitSearch();
    }
  };

  const handleExitSearch = () => {
    setIsSearchActive(false);
    setResults([]);
    setPage(1);
    setSelectedPostIndex(null);
    setNavHistory([]);
  };

  // Smooth slide animation value for screen navigation
  const screenTranslateX = useRef(new Animated.Value(0)).current;
  const isAnimatingBack = useRef(false);
  const resultsScrollRef = useRef<ScrollView>(null);

  // Use a ref to always access the latest handleGoBack without stale closures
  const handleGoBackRef = useRef(handleGoBack);
  handleGoBackRef.current = handleGoBack;

  const commitGoBack = () => {
    if (isAnimatingBack.current) return;
    isAnimatingBack.current = true;
    // Önce state'i değiştir: foreground hâlâ ekran dışında park etmişken
    // görünmez alanda takas olur. Reset'i sonraki frame'lere bırak ki
    // React commit'i bitmeden foreground 0'a dönüp yeni içeriği
    // bir kare bile göstermesin (göz kırpma buydu).
    handleGoBackRef.current();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        screenTranslateX.setValue(0);
        // Dondurulmuş önizlemeyi temizle: artık foreground hedefin kendisi.
        setBackPreview(null);
        isAnimatingBack.current = false;
      });
    });
  };

  const handleGoBackWithSlide = () => {
    if (isAnimatingBack.current) return;
    Haptics.selectionAsync();
    Animated.timing(screenTranslateX, {
      toValue: SCREEN_WIDTH,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      commitGoBack();
    });
  };

  // Interactive Left Edge Swipe — rebuilt each render to capture latest state via ref
  const edgePanResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 8 && Math.abs(gesture.dy) < 40,
        onPanResponderMove: (_, gesture) => {
          if (gesture.dx > 0) {
            screenTranslateX.setValue(gesture.dx);
          }
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 80 || (gesture.dx > 30 && gesture.vx > 0.35)) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Animated.timing(screenTranslateX, {
              toValue: SCREEN_WIDTH,
              duration: 180,
              useNativeDriver: true,
            }).start(() => {
              commitGoBack();
            });
          } else {
            Animated.spring(screenTranslateX, {
              toValue: 0,
              damping: 24,
              stiffness: 260,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [screenTranslateX]
  );

  // Previous state for underlay live preview
  const previousState = navHistory.length > 0 ? navHistory[navHistory.length - 1] : null;
  // Animasyon boyunca underlay hedef karede donmuş kalır: pop anında
  // previousState bir derinliğe kayar, backPreview hedefi korur.
  const underlayEntry = backPreview ?? previousState;
  // Hedef kare viewer'lıysa underlay grid üstüne aynı içeriğin statik
  // snapshot'ını çizer: final kare (grid + animasyonsuz modal) ile birebir.
  const underlayViewerPost =
    underlayEntry != null &&
    typeof underlayEntry.selectedPostIndex === 'number' &&
    underlayEntry.results[underlayEntry.selectedPostIndex]
      ? underlayEntry.results[underlayEntry.selectedPostIndex]
      : null;

  // Parallax Underlay Interpolations
  const underlayTranslateX = screenTranslateX.interpolate({
    inputRange: [0, SCREEN_WIDTH],
    outputRange: [-SCREEN_WIDTH * 0.28, 0],
    extrapolate: 'clamp',
  });

  const underlayDimOpacity = screenTranslateX.interpolate({
    inputRange: [0, SCREEN_WIDTH],
    outputRange: [0.38, 0],
    extrapolate: 'clamp',
  });

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

  const hasCustomFiltersFor = (fc: SearchFilterConfig) =>
    fc.sortBy !== 'default' ||
    fc.timeRange !== 'all' ||
    fc.rating !== 'all' ||
    fc.minScore !== undefined ||
    (fc.cumstService && fc.cumstService !== 'all') ||
    (fc.cumstMediaType && fc.cumstMediaType !== 'all') ||
    fc.jumpToPage > 1;

  const hasCustomFilters = hasCustomFiltersFor(filterConfig);

  // Underlay önizlemesi foreground ile piksel-piksel aynı olmalı:
  // hızlı filtre çipleri interaktif olmayan kopyalarla birebir yansıtılır.
  const renderStaticPresetChips = (fc: SearchFilterConfig) => {
    if (activeSource.type === 'cumst') {
      return (
        <>
          <View style={[styles.quickChip, fc.sortBy === 'score' && fc.timeRange === '1d' && styles.quickChipActive]}>
            <Flame size={13} color={fc.sortBy === 'score' && fc.timeRange === '1d' ? '#111216' : '#FF7B72'} />
            <Text style={[styles.quickChipText, fc.sortBy === 'score' && fc.timeRange === '1d' && styles.quickChipTextActive]}>
              Günün Lideri
            </Text>
          </View>
          <View style={[styles.quickChip, fc.sortBy === 'score' && fc.timeRange === '1w' && styles.quickChipActive]}>
            <Calendar size={13} color={fc.sortBy === 'score' && fc.timeRange === '1w' ? '#111216' : '#58A6FF'} />
            <Text style={[styles.quickChipText, fc.sortBy === 'score' && fc.timeRange === '1w' && styles.quickChipTextActive]}>
              Haftanın Lideri
            </Text>
          </View>
          <View style={[styles.quickChip, fc.sortBy === 'score' && fc.timeRange === '1m' && styles.quickChipActive]}>
            <Star size={13} color={fc.sortBy === 'score' && fc.timeRange === '1m' ? '#111216' : '#FCC419'} />
            <Text style={[styles.quickChipText, fc.sortBy === 'score' && fc.timeRange === '1m' && styles.quickChipTextActive]}>
              Ayın Lideri
            </Text>
          </View>
          <View style={[styles.quickChip, fc.cumstMediaType === 'videos' && styles.quickChipActive]}>
            <Sparkles size={13} color={fc.cumstMediaType === 'videos' ? '#111216' : '#A371F7'} />
            <Text style={[styles.quickChipText, fc.cumstMediaType === 'videos' && styles.quickChipTextActive]}>
              Videolar
            </Text>
          </View>
          <View style={[styles.quickChip, fc.cumstService === 'onlyfans' && styles.quickChipActive]}>
            <Text style={[styles.quickChipText, fc.cumstService === 'onlyfans' && styles.quickChipTextActive]}>
              OnlyFans
            </Text>
          </View>
          <View style={[styles.quickChip, fc.cumstService === 'fansly' && styles.quickChipActive]}>
            <Text style={[styles.quickChipText, fc.cumstService === 'fansly' && styles.quickChipTextActive]}>
              Fansly
            </Text>
          </View>
        </>
      );
    }
    return (
      <>
        <View style={[styles.quickChip, fc.sortBy === 'score' && fc.timeRange === '1w' && styles.quickChipActive]}>
          <Flame size={13} color={fc.sortBy === 'score' && fc.timeRange === '1w' ? '#111216' : '#FF7B72'} />
          <Text style={[styles.quickChipText, fc.sortBy === 'score' && fc.timeRange === '1w' && styles.quickChipTextActive]}>
            Popüler (Hafta)
          </Text>
        </View>
        <View style={[styles.quickChip, fc.sortBy === 'score' && fc.timeRange === '1m' && styles.quickChipActive]}>
          <Calendar size={13} color={fc.sortBy === 'score' && fc.timeRange === '1m' ? '#111216' : '#58A6FF'} />
          <Text style={[styles.quickChipText, fc.sortBy === 'score' && fc.timeRange === '1m' && styles.quickChipTextActive]}>
            Popüler (Ay)
          </Text>
        </View>
        <View style={[styles.quickChip, fc.rating === 'safe' && styles.quickChipActive]}>
          <ShieldCheck size={13} color={fc.rating === 'safe' ? '#111216' : '#51CF66'} />
          <Text style={[styles.quickChipText, fc.rating === 'safe' && styles.quickChipTextActive]}>
            Safe (Güvenli)
          </Text>
        </View>
        <View style={[styles.quickChip, fc.minScore === 50 && styles.quickChipActive]}>
          <Star size={13} color={fc.minScore === 50 ? '#111216' : '#FCC419'} />
          <Text style={[styles.quickChipText, fc.minScore === 50 && styles.quickChipTextActive]}>
            50+ Puan
          </Text>
        </View>
      </>
    );
  };

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
      {/* 1. UNDERLAY PREVIEW LAYER (Revealed during live edge swipe or back slide) */}
      {(isSearchActive || navHistory.length > 0) && (
        <Animated.View
          style={[
            styles.underlayContainer,
            {
              paddingTop: insets.top,
              transform: [{ translateX: underlayTranslateX }],
            },
          ]}
          pointerEvents="none"
        >
          {underlayEntry ? (
            <View style={styles.underlayContentWrapper}>
              {/* Previous Search Bar — final ekranla piksel-piksel aynı:
                  previousState varken foreground'da (isSearchActive) her zaman
                  back butonu görünür, underlay de aynısını gösterir. */}
              <View style={styles.searchBarWrapper}>
                <View style={styles.backButton}>
                  <ArrowLeft size={20} color="#FFFFFF" />
                </View>
                <View style={styles.searchInputContainer}>
                  <Search size={18} color={Colors.dark.textMuted} />
                  {underlayEntry.query || underlayEntry.filterConfig.tags.length > 0 ? (
                    <Text style={styles.underlaySearchText} numberOfLines={1}>
                      {underlayEntry.query || underlayEntry.filterConfig.tags.join(' ')}
                    </Text>
                  ) : (
                    <Text style={styles.underlaySearchPlaceholder} numberOfLines={1}>
                      Etiket veya içerik üretici ara...
                    </Text>
                  )}
                  {underlayEntry.query.length > 0 && (
                    <View style={styles.clearIcon}>
                      <X size={16} color={Colors.dark.textMuted} />
                    </View>
                  )}
                </View>
                <View style={styles.filterButton}>
                  <SlidersHorizontal
                    size={18}
                    color={hasCustomFiltersFor(underlayEntry.filterConfig) ? GOLD_ACCENT : '#FFFFFF'}
                  />
                  {hasCustomFiltersFor(underlayEntry.filterConfig) && (
                    <View style={styles.activeFilterDot} />
                  )}
                </View>
              </View>

              {/* Previous Results Grid Preview — foreground ile birebir aynı
                  yapı: hızlı filtre satırı + banner pill'leri + tam grid.
                  Herhangi biri eksik olursa commit sonrası ekran sıçrar. */}
              <View style={styles.quickFiltersContainer}>
                <View style={[styles.quickFiltersContent, { flexDirection: 'row' }]}>
                  {onOpenSourcePicker && (
                    <View style={styles.sourceQuickChip}>
                      <Layers size={13} color={Colors.dark.primaryLight} />
                      <Text style={styles.sourceQuickChipText} numberOfLines={1}>
                        {activeSource.name.split(' ')[0]}
                      </Text>
                    </View>
                  )}
                  <View
                    style={[
                      styles.quickChip,
                      hasCustomFiltersFor(underlayEntry.filterConfig) && styles.quickChipActive,
                    ]}
                  >
                    <SlidersHorizontal
                      size={13}
                      color={hasCustomFiltersFor(underlayEntry.filterConfig) ? '#111216' : GOLD_ACCENT}
                    />
                    <Text
                      style={[
                        styles.quickChipText,
                        hasCustomFiltersFor(underlayEntry.filterConfig) && styles.quickChipTextActive,
                      ]}
                    >
                      Filtreler {hasCustomFiltersFor(underlayEntry.filterConfig) ? '• Açık' : ''}
                    </Text>
                  </View>
                  {renderStaticPresetChips(underlayEntry.filterConfig)}
                </View>
              </View>
              <View style={styles.underlayResultsArea}>
                <View style={styles.activeTagBanner}>
                  <View style={styles.activeTagInfo}>
                    <Text style={styles.activeTagName}>
                      {underlayEntry.filterConfig.tags.length > 0
                        ? `#${underlayEntry.filterConfig.tags.join(' #')}`
                        : 'Tüm Gönderiler'}
                    </Text>
                    <Text style={styles.activeTagCount}>
                      ({underlayEntry.results.length}+ sonuç)
                    </Text>
                  </View>
                  {hasCustomFiltersFor(underlayEntry.filterConfig) && (
                    <View style={styles.activeFiltersPillRow}>
                      {underlayEntry.filterConfig.sortBy === 'score' && (
                        <View style={styles.smallFilterPill}>
                          <Text style={styles.smallFilterPillText}>
                            🔥 Popüler ({underlayEntry.filterConfig.timeRange})
                          </Text>
                        </View>
                      )}
                      {underlayEntry.filterConfig.rating !== 'all' && (
                        <View style={styles.smallFilterPill}>
                          <Text style={styles.smallFilterPillText}>
                            🛡️ {underlayEntry.filterConfig.rating}
                          </Text>
                        </View>
                      )}
                      {underlayEntry.filterConfig.minScore && (
                        <View style={styles.smallFilterPill}>
                          <Text style={styles.smallFilterPillText}>
                            ⭐ {underlayEntry.filterConfig.minScore}+
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </View>

                <View style={styles.gridContainer}>
                  <View style={styles.column}>
                    {underlayEntry.results
                      .filter((_, i) => i % 2 === 0)
                      .map((post, idx) => (
                        <PostCard
                          key={`underlay-l-${post.id}-${idx}`}
                          post={post}
                          onPress={() => {}}
                        />
                      ))}
                  </View>
                  <View style={styles.column}>
                    {underlayEntry.results
                      .filter((_, i) => i % 2 !== 0)
                      .map((post, idx) => (
                        <PostCard
                          key={`underlay-r-${post.id}-${idx}`}
                          post={post}
                          onPress={() => {}}
                        />
                      ))}
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.underlayContentWrapper}>
              {/* Explore Screen Underlay Preview — foreground ile aynı yapı:
                  başlık + arama + hızlı filtre + tam listeler */}
              <View style={styles.topHeader}>
                <View>
                  <Text style={styles.topHeaderTitle}>Arama</Text>
                  <Text style={styles.topHeaderSubtitle}>Etiket veya görsel keşfet</Text>
                </View>
                {onOpenSourcePicker && (
                  <View style={styles.sourcePill}>
                    <Layers size={14} color={Colors.dark.primaryLight} />
                    <Text style={styles.sourceText} numberOfLines={1}>
                      {activeSource.name.split(' ')[0]}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.searchBarWrapper}>
                <View style={styles.searchInputContainer}>
                  <Search size={18} color={Colors.dark.textMuted} />
                  <Text style={styles.underlaySearchPlaceholder}>
                    Etiket veya içerik üretici ara...
                  </Text>
                </View>
                <View style={styles.filterButton}>
                  <SlidersHorizontal size={18} color={hasCustomFilters ? GOLD_ACCENT : '#FFFFFF'} />
                  {hasCustomFilters && <View style={styles.activeFilterDot} />}
                </View>
              </View>

              <View style={styles.quickFiltersContainer}>
                <View style={[styles.quickFiltersContent, { flexDirection: 'row' }]}>
                  {onOpenSourcePicker && (
                    <View style={styles.sourceQuickChip}>
                      <Layers size={13} color={Colors.dark.primaryLight} />
                      <Text style={styles.sourceQuickChipText} numberOfLines={1}>
                        {activeSource.name.split(' ')[0]}
                      </Text>
                    </View>
                  )}
                  <View style={[styles.quickChip, hasCustomFilters && styles.quickChipActive]}>
                    <SlidersHorizontal size={13} color={hasCustomFilters ? '#111216' : GOLD_ACCENT} />
                    <Text style={[styles.quickChipText, hasCustomFilters && styles.quickChipTextActive]}>
                      Filtreler {hasCustomFilters ? '• Açık' : ''}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.exploreContent}>
                {history.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <View style={styles.sectionTitleWithIcon}>
                        <Clock size={16} color={Colors.dark.textSecondary} />
                        <Text style={styles.sectionTitle}>Son Aramalar</Text>
                      </View>
                    </View>
                    <View style={styles.tagWrap}>
                      {history.map((tag, idx) => (
                        <TagChip
                          key={`underlay-hist-${tag}-${idx}`}
                          name={tag}
                          category="general"
                        />
                      ))}
                    </View>
                  </View>
                )}

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
                          key={`underlay-fav-${tag}-${idx}`}
                          name={tag}
                          category="meta"
                        />
                      ))}
                    </View>
                  </View>
                )}

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
                        key={`underlay-pop-${tag}-${idx}`}
                        name={tag}
                        category="general"
                      />
                    ))}
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* Underlay Darkening Scrim Layer */}
          <Animated.View
            style={[
              styles.underlayScrim,
              { opacity: underlayDimOpacity },
            ]}
          />
        </Animated.View>
      )}

      {/* 2. FOREGROUND SLIDING LAYER */}
      <Animated.View
        style={[
          styles.screenAnimatedContent,
          {
            paddingTop: insets.top,
            transform: [{ translateX: screenTranslateX }],
          },
        ]}
      >
        {/* Top Header with Active Source Badge (when search is not active) */}
        {!isSearchActive && (
          <View style={styles.topHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {onBackPress && (
                <TouchableOpacity
                  style={[styles.backButton, { position: 'relative', left: 0, top: 0, marginRight: 12 }]}
                  onPress={onBackPress}
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

            {onOpenSourcePicker && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => {
                  Haptics.selectionAsync();
                  onOpenSourcePicker();
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
          {isSearchActive && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={handleGoBackWithSlide}
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
            {onOpenSourcePicker && (
              <TouchableOpacity
                style={styles.sourceQuickChip}
                onPress={() => {
                  Haptics.selectionAsync();
                  onOpenSourcePicker();
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
      </Animated.View>

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
  underlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.dark.background,
    overflow: 'hidden',
  },
  underlayContentWrapper: {
    flex: 1,
  },
  underlayResultsArea: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  underlaySearchText: {
    flex: 1,
    marginLeft: 8,
    color: Colors.dark.text,
    fontSize: 14,
    fontWeight: '600',
  },
  underlaySearchPlaceholder: {
    flex: 1,
    marginLeft: 8,
    color: Colors.dark.textMuted,
    fontSize: 14,
  },
  underlayScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
  },
  screenAnimatedContent: {
    flex: 1,
    backgroundColor: Colors.dark.background,
    shadowColor: '#000000',
    shadowOffset: { width: -6, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 12,
    elevation: 16,
  },
  leftEdgeGestureArea: {
    position: 'absolute',
    left: 0,
    top: 75,
    bottom: 85,
    width: 32,
    zIndex: 999,
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


