import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  RefreshControl,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Layers, RefreshCw, AlertCircle, Flame } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { booruApi } from '../services/booruApi';
import { BooruPost, BooruSource, DEFAULT_FILTER_CONFIG, SearchFilterConfig, RedGifsTrendingTag } from '../types/booru';
import { PostCard } from '../components/PostCard';
import { TagChip } from '../components/TagChip';
import { SourceSheet } from '../components/SourceSheet';
import { pushViewer, pushSearchDetail } from '../navigation/rootNavigation';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { Colors } from '../theme/colors';
import { getMediaHeaders, getMediaUrl, isImageMediaUrl } from '../utils/media';
import { useVisibleIds, useMountedIds, useFocusedCardIds, CardLayout } from '../utils/gridVisibility';
import { useSource } from '../context/SourceContext';
import { useMediaPlaybackAllowed } from '../context/MediaPlaybackContext';
import { StorageService, FeedOrder } from '../services/storage';
import { getSourceQuickFilters, isQuickFilterActive, normalizeFeedQuickFilter } from '../utils/sourceQuickFilters';
import { updateFreezeProbe } from '../utils/freezeProbe';
import { getPostKey } from '../utils/postIdentity';
import { getGridPreviewVideoCandidates } from '../utils/gridPreviewMedia';
import { useScrollAwayHeader } from '../utils/scrollAwayHeader';
import { ScrollAwayHeader } from '../components/ScrollAwayHeader';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GOLD_ACCENT = '#F5A623';

function feedOrderKey(order: FeedOrder): string {
  return `${order.sortBy}|${order.timeRange}|${order.hentaiHavenSection ?? ''}`;
}

interface FeedScreenProps {
  navigation?: any;
  onSelectTag?: (tag: string, mode?: 'replace' | 'add' | 'exclude') => void;
  activeSource?: BooruSource;
  onOpenSourcePicker?: () => void;
}

export const FeedScreen: React.FC<FeedScreenProps> = ({
  navigation: propNavigation,
  onSelectTag,
  activeSource: propSource,
  onOpenSourcePicker,
}) => {
  const hookNavigation = useNavigation<any>();
  const navigation = propNavigation ?? hookNavigation;
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
  const { activeSource: contextSource } = useSource();
  const activeSource = propSource ?? contextSource;
  const insets = useSafeAreaInsets();
  const [posts, setPosts] = useState<BooruPost[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [feedOrder, setFeedOrder] = useState<FeedOrder>({ sortBy: 'default', timeRange: 'all' });
  // RedGifs trending tags: row adding variety to the fixed trending feed
  const [trendingTags, setTrendingTags] = useState<RedGifsTrendingTag[]>([]);
  const isFocused = useIsFocused();
  const mediaAllowed = useMediaPlaybackAllowed();
  const isRedGifs = activeSource.type === 'redgifs';
  const feedOptions = getSourceQuickFilters(activeSource, 'feed');
  // A global saved RedGifs/HH preset must not leak into another provider.
  const normalizedOrder = normalizeFeedQuickFilter(activeSource, feedOrder);
  const selectedOrder: FeedOrder = {
    sortBy: normalizedOrder.sortBy ?? 'default', timeRange: normalizedOrder.timeRange ?? 'all',
    hentaiHavenSection: normalizedOrder.hentaiHavenSection,
  };
  const feedKey = `${activeSource.id}|${feedOrderKey(selectedOrder)}`;
  const header = useScrollAwayHeader({
    enabled: !loading && !error && posts.length > 0,
    resetKey: feedKey,
    pinned: !isFocused || refreshing || isSourceSheetOpen,
  });
  const feedKeyRef = useRef(feedKey);
  feedKeyRef.current = feedKey;
  const requestIdRef = useRef(0);
  const requestPendingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const postsRef = useRef(posts);
  useEffect(() => { updateFreezeProbe({ feedCount: posts.length }); }, [posts.length]);

  useEffect(() => {
    if (!isRedGifs) {
      setTrendingTags([]);
      return;
    }
    let cancelled = false;
    booruApi.fetchRedGifsTrendingTags(20).then((tags) => {
      if (!cancelled) setTrendingTags(tags);
    });
    return () => {
      cancelled = true;
    };
  }, [isRedGifs, activeSource.id]);

  // Video covers play only while on screen (prevents stutter)
  const [visibleIds, updateVisible] = useVisibleIds();
  // Focused-player architecture: the 2-4 cards nearest the on-screen center play video
  const [focusedIds, updateFocused] = useFocusedCardIds(80, 4);
  // Mount window: distant cards fall back to placeholders, releasing player/timer/image.
  // null = not computed yet (first paint), all cards render.
  const [mountedIds, updateMounted] = useMountedIds();

  // Refresh the fav set when returning to the cover — faved items badge instantly in viewer
  useEffect(() => {
    if (isFocused) {
      StorageService.getFavorites().then((favs) => {
        setFavoriteIds(new Set(favs.map(getPostKey)));
      });
    }
  }, [isFocused]);

  const loadPosts = useCallback(
    async (pageNum: number, isRefresh: boolean = false) => {
      if (pageNum > 1 && (requestPendingRef.current || !hasMoreRef.current)) return;
      const requestId = ++requestIdRef.current;
      requestPendingRef.current = true;
      if (pageNum === 1) hasMoreRef.current = true;
      const isCurrent = () => requestId === requestIdRef.current && feedKey === feedKeyRef.current;
      try {
        if (pageNum === 1 && !isRefresh) setLoading(true);
        setError(null);

        const feedFilter: SearchFilterConfig = {
          ...DEFAULT_FILTER_CONFIG,
          ...selectedOrder,
        };
        const queryTags = booruApi.buildQueryTags(feedFilter, activeSource);
        const newPosts = await booruApi.fetchPosts(pageNum, 24, queryTags, feedFilter, activeSource);
        // A stale request finishing during a source/order change must not overwrite the new list.
        if (!isCurrent()) return;

        // Stop quietly on 429/empty pages: keep the footer loader from sticking
        if (newPosts.length === 0 && pageNum > 1) {
          hasMoreRef.current = false;
          return;
        }

        // Pre-warm: the SAME entry the grid will read (getMediaUrl + URL key).
        // prefetch does not support cacheKey, so the grid uses the URL key too.
        // Video/archive URLs cannot warm an image cache.
        newPosts.slice(0, 10).forEach((p) => {
          const raw = p.previewUrl || p.sampleUrl;
          if (!isImageMediaUrl(raw)) return;
          const u = getMediaUrl(raw);
          if (u) {
            Image.prefetch(u, { headers: getMediaHeaders(u) }).catch(() => {});
          }
        });

        const previous = pageNum === 1 ? [] : postsRef.current;
        const existingIds = new Set(previous.map((p) => p.id));
        const uniqueNew = newPosts.filter((p) => {
          if (existingIds.has(p.id)) return false;
          existingIds.add(p.id);
          return true;
        });
        if (uniqueNew.length === 0) hasMoreRef.current = false;
        postsRef.current = [...previous, ...uniqueNew];
        setPosts(postsRef.current);
        setPage(pageNum);
      } catch (err: any) {
        if (!isCurrent()) return;
        console.warn('[FeedScreen] loadPosts error:', err);
        // The page advances only on success; the same page can be retried after an error.
        if (pageNum === 1) {
          setError(err?.message || 'An error occurred while loading images.');
        }
      } finally {
        if (isCurrent()) {
          requestPendingRef.current = false;
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [feedKey]
  );

  const scrollViewRef = useRef<ScrollViewInstance>(null);
  const scrollOffsetRef = useRef(0);
  const gridTopRef = useRef(0);
  const viewportHeightRef = useRef(SCREEN_HEIGHT);
  // Reload from scratch when the source or order changes. The stored order is read
  // async, so no first request fires before it is "ready" (otherwise every launch
  // would load Trending and the user preference would arrive on the second round).
  const [feedOrderReady, setFeedOrderReady] = useState(false);

  useEffect(() => {
    StorageService.getFeedOrder().then((saved) => {
      if (saved) setFeedOrder(saved);
      setFeedOrderReady(true);
    });
  }, []);

  useEffect(() => {
    if (!feedOrderReady) return;
    postsRef.current = [];
    setPosts([]);
    setPage(1);
    scrollOffsetRef.current = 0;
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    loadPosts(1);
    return () => { requestIdRef.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedKey, feedOrderReady]);

  const handleSelectOrder = (order: FeedOrder) => {
    if (feedOrderKey(order) === feedOrderKey(selectedOrder)) return;
    Haptics.selectionAsync();
    setFeedOrder(order);
    StorageService.setFeedOrder(order);
  };

  const handleRefresh = async () => {
    header.reset();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    setPage(1);
    scrollOffsetRef.current = 0;
    await loadPosts(1, true);
  };

  const handleLoadMore = () => {
    if (!isFocused || loadingMore || loading || refreshing || requestPendingRef.current || !hasMoreRef.current) return;
    setLoadingMore(true);
    void loadPosts(page + 1);
  };

  const isCloseToBottom = ({
    layoutMeasurement,
    contentOffset,
    contentSize,
  }: any) => {
    return layoutMeasurement.height + contentOffset.y >= contentSize.height - 900;
  };

  // Height-balanced masonry: each card goes to the currently shorter column.
  // Both columns end level; no dead space remains under the short column,
  // so the user never scrolls through emptiness waiting for the bottom.
  // (Greedy is deterministic: adding a new page never reshuffles old assignments.)
  const leftColumn: BooruPost[] = [];
  const rightColumn: BooruPost[] = [];
  const layoutMap = new Map<string, CardLayout>();
  {
    const colW = (SCREEN_WIDTH - 36) / 2; // same width as PostCard
    let leftH = 0;
    let rightH = 0;
    posts.forEach((post) => {
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
    posts.forEach((p) => {
      if (getGridPreviewVideoCandidates(p, Platform.OS).length > 0) {
        set.add(p.id);
      }
    });
    return set;
  }, [posts]);
  const playableIdsRef = useRef(playableIds);
  playableIdsRef.current = playableIds;
  const lastGridUpdateRef = useRef(0);
  const updateGridViewport = useCallback((immediate = false) => {
    const covered = header.occlusionRef.current;
    const offset = scrollOffsetRef.current - gridTopRef.current + covered;
    const height = Math.max(0, viewportHeightRef.current - covered);
    updateVisible(layoutMapRef.current, offset, height);
    updateMounted(layoutMapRef.current, offset, height);
    updateFocused(layoutMapRef.current, offset, height, playableIdsRef.current, immediate);
  }, [updateVisible, updateMounted, updateFocused]);

  // Play the first screen's videos immediately when the list changes
  useEffect(() => {
    updateGridViewport(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, header.height, header.enabled]);

  const handleCardPress = useCallback((post: BooruPost) => {
    const idx = posts.findIndex((p) => p.id === post.id);
    if (idx >= 0) {
      pushViewer(posts, idx, [], undefined, activeSource);
    }
  }, [posts, activeSource]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScrollAwayHeader controller={header} top={insets.top}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            scrollViewRef.current?.scrollTo({ y: 0, animated: true });
          }}
        >
          <Text style={styles.headerTitle}>Explore</Text>
          <Text style={styles.headerSubtitle}>
            {isRedGifs ? 'Video clips and animations' : 'Latest anime and illustrations'}
          </Text>
        </TouchableOpacity>

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

      {/* Source-aware order presets. A single Discover choice is not a filter. */}
      {feedOptions.length > 1 && (
        <View style={styles.orderBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.orderBarContent}
          >
            {feedOptions.map((opt) => {
              const isSelected = isQuickFilterActive(opt, selectedOrder);
              return (
                <TouchableOpacity
                  key={opt.id}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                  accessibilityState={{ selected: isSelected }}
                  style={[styles.orderChip, isSelected && styles.orderChipActive]}
                  onPress={() => handleSelectOrder({ sortBy: opt.patch.sortBy ?? 'default', timeRange: opt.patch.timeRange ?? 'all', hentaiHavenSection: opt.patch.hentaiHavenSection })}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.orderChipText, isSelected && styles.orderChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}
      {/* Trending tags: daily hot searches, one tap to feed */}
      {isRedGifs && trendingTags.length > 0 && (
        <View style={styles.trendingBar}>
          <View style={styles.trendingHeaderRow}>
            <Flame size={13} color={GOLD_ACCENT} />
            <Text style={styles.trendingHeaderText}>Trending Tags</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.trendingContent}
          >
            {trendingTags.map((t) => (
              <TagChip
                key={`rg-trend-${t.name}`}
                name={t.name}
                count={t.count || undefined}
                size="sm"
                onPress={(name) => {
                  Haptics.selectionAsync();
                  pushSearchDetail([name], undefined, activeSource);
                }}
              />
            ))}
          </ScrollView>
        </View>
      )}
      </ScrollAwayHeader>

      {/* Main Content */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Colors.dark.primary} />
          <Text style={styles.loadingText}>Loading posts...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <AlertCircle size={44} color={Colors.dark.danger} />
          <Text style={styles.errorTitle}>Connection Error</Text>
          <Text style={styles.errorText}>
            {error.includes('certificate') || error.includes('timed out')
              ? `Could not reach the ${activeSource.name} source due to ISP or SSL blocking.`
              : error}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => {
                Haptics.selectionAsync();
                loadPosts(1);
              }}
            >
              <RefreshCw size={16} color="#FFFFFF" />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>

            {showSourcePicker && (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Change source"
                style={[
                  styles.retryButton,
                  {
                    backgroundColor: Colors.dark.surface,
                    borderWidth: 1,
                    borderColor: Colors.dark.cardBorder,
                  },
                ]}
                onPress={() => {
                  Haptics.selectionAsync();
                  handleOpenSourcePicker();
                }}
              >
                <Layers size={16} color={Colors.dark.primaryLight} />
                <Text style={[styles.retryText, { color: Colors.dark.text }]}>
                  Change Source
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, header.enabled && { paddingTop: header.height + 12 }]}
          showsVerticalScrollIndicator={false}
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.dark.primary}
            />
          }
          onScroll={(event) => {
            const changed = header.onScroll(event);
            const { nativeEvent } = event;
            scrollOffsetRef.current = nativeEvent.contentOffset.y;
            viewportHeightRef.current = nativeEvent.layoutMeasurement.height;
            const now = Date.now();
            if (changed || now - lastGridUpdateRef.current >= 100) {
              lastGridUpdateRef.current = now;
              updateGridViewport(changed);
            }
            if (isCloseToBottom(nativeEvent)) {
              handleLoadMore();
            }
          }}
          onMomentumScrollEnd={() => updateGridViewport(true)}
          onScrollEndDrag={() => updateGridViewport(true)}
          onLayout={({ nativeEvent }) => { viewportHeightRef.current = nativeEvent.layout.height; updateGridViewport(true); }}
          scrollEventThrottle={32}
        >
          {/* 2-Column Masonry Grid */}
          <View style={styles.gridContainer} onLayout={({ nativeEvent }) => { gridTopRef.current = nativeEvent.layout.y; updateGridViewport(true); }}>
            <View style={styles.column}>
              {leftColumn.map((post) =>
                mountedIds && !mountedIds.has(post.id) ? (
                  <View
                    key={`feed-${post.id}`}
                    style={{ height: layoutMap.get(post.id)?.h ?? 320 }}
                  />
                ) : (
                  <PostCard
                    key={`feed-${post.id}`}
                    post={post}
                    onPress={handleCardPress}
                    favoriteIds={favoriteIds}
                    column="left"
                    screenActive={isFocused && mediaAllowed && !isSourceSheetOpen}
                    videoActive={focusedIds.has(post.id)}
                    onScreen={visibleIds.has(post.id)}
                  />
                )
              )}
            </View>
            <View style={styles.column}>
              {rightColumn.map((post) =>
                mountedIds && !mountedIds.has(post.id) ? (
                  <View
                    key={`feed-${post.id}`}
                    style={{ height: layoutMap.get(post.id)?.h ?? 320 }}
                  />
                ) : (
                  <PostCard
                    key={`feed-${post.id}`}
                    post={post}
                    onPress={handleCardPress}
                    favoriteIds={favoriteIds}
                    column="right"
                    screenActive={isFocused && mediaAllowed && !isSourceSheetOpen}
                    videoActive={focusedIds.has(post.id)}
                    onScreen={visibleIds.has(post.id)}
                  />
                )
              )}
            </View>
          </View>

          {/* Footer loader */}
          {loadingMore && (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={Colors.dark.primary} />
              <Text style={styles.footerText}>Loading more...</Text>
            </View>
          )}
        </ScrollView>
      )}


      <SourceSheet
        visible={isSourceSheetOpen}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.dark.divider,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: Colors.dark.text,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
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
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.cardBorder,
  },
  sourceText: {
    color: Colors.dark.text,
    fontSize: 11,
    fontWeight: '700',
  },
  orderBar: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.07)',
    paddingBottom: 10,
  },
  orderBarContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  orderChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#181A22',
    borderWidth: 1,
    borderColor: '#292D3B',
  },
  orderChipActive: {
    backgroundColor: GOLD_ACCENT,
    borderColor: GOLD_ACCENT,
  },
  orderChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  orderChipTextActive: {
    color: '#111216',
    fontWeight: '700',
  },
  trendingBar: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.07)',
    paddingBottom: 8,
  },
  trendingHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  trendingHeaderText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.dark.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  trendingContent: {
    paddingHorizontal: 16,
    paddingVertical: 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 24,
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
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
    marginTop: 12,
  },
  errorText: {
    fontSize: 13,
    color: Colors.dark.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 16,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  retryText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 14,
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
});
