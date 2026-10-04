import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  RefreshControl,
  ScrollView,
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
import { BooruPost, BooruSource, DEFAULT_FILTER_CONFIG, HentaiHavenFeedSection, SearchFilterConfig, RedGifsTrendingTag } from '../types/booru';
import { PostCard } from '../components/PostCard';
import { TagChip } from '../components/TagChip';
import { pushViewer, pushSearchDetail } from '../navigation/rootNavigation';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { Colors } from '../theme/colors';
import { getMediaHeaders, getMediaUrl, isVideoPost } from '../utils/media';
import { useVisibleIds, useMountedIds, useFocusedCardIds, CardLayout } from '../utils/gridVisibility';
import { useSource } from '../context/SourceContext';
import { useMediaPlaybackAllowed } from '../context/MediaPlaybackContext';
import { StorageService, FeedOrder } from '../services/storage';
import { HENTAIHAVEN_FEED_SECTIONS } from '../services/hentaihavens';
import { updateFreezeProbe } from '../utils/freezeProbe';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GOLD_ACCENT = '#F5A623';

/** Keşfet sırası seçenekleri. RedGifs order=değerlerine birebir karşılık gelir. */
const FEED_ORDER_OPTIONS: { key: string; label: string; order: FeedOrder }[] = [
  { key: 'trending', label: 'Trend', order: { sortBy: 'default', timeRange: 'all' } },
  { key: 'latest', label: 'En Yeni', order: { sortBy: 'id', timeRange: 'all' } },
  { key: 'top7', label: 'Haftalık Top', order: { sortBy: 'score', timeRange: '1w' } },
  { key: 'top28', label: 'Aylık Top', order: { sortBy: 'score', timeRange: '1m' } },
];

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

  const handleOpenSourcePicker = () => {
    if (onOpenSourcePicker) {
      onOpenSourcePicker();
    } else if (navigation?.navigate) {
      navigation.navigate('Settings');
    }
  };

  const showSourcePicker = Boolean(onOpenSourcePicker) || Boolean(navigation?.navigate);
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
  // Keşfet sırası: yalnız RedGifs'te seçilebilir (order parametresi orada anlamlı)
  const [feedOrder, setFeedOrder] = useState<FeedOrder>(FEED_ORDER_OPTIONS[0].order);
  // RedGifs trend etiketleri: sabit trending akışına çeşitlilik katan satır
  const [trendingTags, setTrendingTags] = useState<RedGifsTrendingTag[]>([]);
  const isFocused = useIsFocused();
  const mediaAllowed = useMediaPlaybackAllowed();
  const isRedGifs = activeSource.type === 'redgifs';
  const isHentaiHaven = activeSource.type === 'hentaihaven';
  const feedKey = `${activeSource.id}|${feedOrderKey(feedOrder)}`;
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

  // Video kapaklar sadece ekrandayken oynar (kasılmayı önler)
  const [visibleIds, updateVisible] = useVisibleIds();
  // Odaklı oyuncu mimarisi: ekrandaki merkeze en yakın 2-4 kart video açar
  const [focusedIds, updateFocused] = useFocusedCardIds(80, 4);
  // Mount penceresi: uzak kartlar yer tutucuya düşer, oyuncu/timer/resim bırakır.
  // null = henüz hesaplanmadı (ilk boya), tüm kartlar render edilir.
  const [mountedIds, updateMounted] = useMountedIds();

  // Kapağa dönünce fav setini tazele — viewer'da favlanan anında rozetlenir
  useEffect(() => {
    if (isFocused) {
      StorageService.getFavorites().then((favs) => {
        setFavoriteIds(new Set(favs.map((p) => p.id)));
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
          sortBy: feedOrder.sortBy,
          timeRange: feedOrder.timeRange,
          hentaiHavenSection: feedOrder.hentaiHavenSection,
        };
        const newPosts = await booruApi.fetchPosts(pageNum, 24, '', feedFilter);
        // Kaynak/sıra değişirken biten eski istek yeni listenin üstüne yazamaz.
        if (!isCurrent()) return;

        // 429/boş sayfada sessizce dur: footer loader takılı kalmasın
        if (newPosts.length === 0 && pageNum > 1) {
          hasMoreRef.current = false;
          return;
        }

        // Pre-warm: grid'in okuyacağı AYNI entry (getMediaUrl + URL key).
        // prefetch cacheKey desteklemez, o yüzden grid de URL key kullanır.
        // MP4 kapaklar video yoldan yüklenir; Image.prefetch boşa indirme yapmasın.
        newPosts.slice(0, 10).forEach((p) => {
          const raw = p.previewUrl || p.sampleUrl;
          if (raw && /\.mp4($|\?)/i.test(raw.split('?')[0])) return;
          const u = getMediaUrl(raw);
          if (u) {
            Image.prefetch(u, { headers: getMediaHeaders(u) });
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
        // Sayfa yalnız başarıda ilerler; hata sonrası aynı sayfa denenebilir.
        if (pageNum === 1) {
          setError(err?.message || 'Görseller yüklenirken bir hata oluştu.');
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
    [feedOrder, feedKey]
  );

  const scrollViewRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  // Kaynak veya sıra değiştiyse baştan yükle. Saklanan sıra async okunduğu
  // için "hazır" olmadan ilk istek atılmaz (aksi halde her açılışta Trend
  // yüklenip kullanıcının tercihi ikinci turda gelirdi).
  const [feedOrderReady, setFeedOrderReady] = useState(false);

  useEffect(() => {
    StorageService.getFeedOrder().then((saved) => {
      if (saved) setFeedOrder(saved);
      setFeedOrderReady(true);
    });
  }, []);

  useEffect(() => {
    if (!feedOrderReady) return;
    booruApi.resetFeedSeen();
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
    if (feedOrderKey(order) === feedOrderKey(feedOrder)) return;
    Haptics.selectionAsync();
    setFeedOrder(order);
    StorageService.setFeedOrder(order);
  };

  const handleSelectHentaiHavenSection = (section: HentaiHavenFeedSection) => {
    if (feedOrder.hentaiHavenSection === section && feedOrder.sortBy === 'default') return;
    Haptics.selectionAsync();
    const order: FeedOrder = { sortBy: 'default', timeRange: 'all', hentaiHavenSection: section };
    setFeedOrder(order);
    StorageService.setFeedOrder(order);
  };

  const handleRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    setPage(1);
    scrollOffsetRef.current = 0;
    booruApi.resetFeedSeen();
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

  // Yükseklik dengeli masonry: her kart o an kısa olan sütuna gider.
  // İki sütun aynı hizada biter; kısa sütun altında ölü boşluk kalmaz,
  // kullanıcı boşlukta kaydırıp dibi beklemek zorunda kalmaz.
  // (Greedy deterministiktir: yeni sayfa eklenince eski atamalar değişmez.)
  const leftColumn: BooruPost[] = [];
  const rightColumn: BooruPost[] = [];
  const layoutMap = new Map<string, CardLayout>();
  {
    const colW = (SCREEN_WIDTH - 36) / 2; // PostCard ile aynı genişlik
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
      if (p.previewVideoUrl || isVideoPost(p) || p.fileExt === 'mp4' || p.fileExt === 'webm') {
        set.add(p.id);
      }
    });
    return set;
  }, [posts]);
  const playableIdsRef = useRef(playableIds);
  playableIdsRef.current = playableIds;

  // Liste değişince ilk ekranın videoları hemen oynasın
  useEffect(() => {
    updateVisible(layoutMapRef.current, scrollOffsetRef.current, SCREEN_HEIGHT);
    updateMounted(layoutMapRef.current, scrollOffsetRef.current, SCREEN_HEIGHT);
    updateFocused(layoutMapRef.current, scrollOffsetRef.current, SCREEN_HEIGHT, playableIdsRef.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts]);

  const handleCardPress = useCallback((post: BooruPost) => {
    const idx = posts.findIndex((p) => p.id === post.id);
    if (idx >= 0) {
      pushViewer(posts, idx, [], undefined);
    }
  }, [posts]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Header */}
      <View style={styles.header}>
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => {
            scrollViewRef.current?.scrollTo({ y: 0, animated: true });
          }}
        >
          <Text style={styles.headerTitle}>Keşfet</Text>
          <Text style={styles.headerSubtitle}>
            {isRedGifs ? 'Video klipleri ve animasyonlar' : 'En yeni anime ve çizimler'}
          </Text>
        </TouchableOpacity>

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

      {/* HentaiHaven bölüm seçici: En Yeni (sayfalı) + Trend/Son Bölümler/Türler (home/genre) */}
      {isHentaiHaven && (
        <View style={styles.orderBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.orderBarContent}
          >
            {HENTAIHAVEN_FEED_SECTIONS.map((opt) => {
              const activeSection = feedOrder.hentaiHavenSection ?? 'latest';
              const isSelected = activeSection === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.orderChip, isSelected && styles.orderChipActive]}
                  onPress={() => handleSelectHentaiHavenSection(opt.key)}
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
      {/* Sıra seçici: yalnız RedGifs'te anlamlı (order= trending/latest/top7/top28) */}
      {isRedGifs && (
        <View style={styles.orderBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.orderBarContent}
          >
            {FEED_ORDER_OPTIONS.map((opt) => {
              const isSelected = feedOrderKey(opt.order) === feedOrderKey(feedOrder);
              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.orderChip, isSelected && styles.orderChipActive]}
                  onPress={() => handleSelectOrder(opt.order)}
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

      {/* Trend etiketleri: günlük değişen sıcak aramalar, tek dokunuşla akışa */}
      {isRedGifs && trendingTags.length > 0 && (
        <View style={styles.trendingBar}>
          <View style={styles.trendingHeaderRow}>
            <Flame size={13} color={GOLD_ACCENT} />
            <Text style={styles.trendingHeaderText}>Trend Etiketler</Text>
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
                  pushSearchDetail([name]);
                }}
              />
            ))}
          </ScrollView>
        </View>
      )}

      {/* Main Content */}
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Colors.dark.primary} />
          <Text style={styles.loadingText}>Gönderiler getiriliyor...</Text>
        </View>
      ) : error ? (
        <View style={styles.centerContainer}>
          <AlertCircle size={44} color={Colors.dark.danger} />
          <Text style={styles.errorTitle}>Bağlantı Hatası</Text>
          <Text style={styles.errorText}>
            {error.includes('certificate') || error.includes('timed out')
              ? `${activeSource.name} kaynağına internet servis sağlayıcısı veya SSL engeli nedeniyle ulaşılamadı.`
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
              <Text style={styles.retryText}>Tekrar Dene</Text>
            </TouchableOpacity>

            {showSourcePicker && (
              <TouchableOpacity
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
                  Kaynak Değiştir
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
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
          onScroll={({ nativeEvent }) => {
            scrollOffsetRef.current = nativeEvent.contentOffset.y;
            updateVisible(
              layoutMapRef.current,
              nativeEvent.contentOffset.y,
              nativeEvent.layoutMeasurement.height
            );
            updateMounted(
              layoutMapRef.current,
              nativeEvent.contentOffset.y,
              nativeEvent.layoutMeasurement.height
            );
            updateFocused(
              layoutMapRef.current,
              nativeEvent.contentOffset.y,
              nativeEvent.layoutMeasurement.height,
              playableIdsRef.current
            );
            if (isCloseToBottom(nativeEvent)) {
              handleLoadMore();
            }
          }}
          scrollEventThrottle={100}
        >
          {/* 2-Column Masonry Grid */}
          <View style={styles.gridContainer}>
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
                    screenActive={isFocused && mediaAllowed}
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
                    screenActive={isFocused && mediaAllowed}
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
              <Text style={styles.footerText}>Daha fazla yükleniyor...</Text>
            </View>
          )}
        </ScrollView>
      )}


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
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.dark.surface,
    borderWidth: 1,
    borderColor: Colors.dark.cardBorder,
  },
  sourceText: {
    color: Colors.dark.text,
    fontSize: 12,
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
