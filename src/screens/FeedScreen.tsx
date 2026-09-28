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
import { BooruPost, BooruSource, DEFAULT_FILTER_CONFIG, SearchFilterConfig, RedGifsTrendingTag } from '../types/booru';
import { PostCard } from '../components/PostCard';
import { TagChip } from '../components/TagChip';
import { pushViewer, pushSearchDetail } from '../navigation/rootNavigation';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { Colors } from '../theme/colors';
import { getMediaHeaders, getMediaUrl } from '../utils/media';
import { useVisibleIds, CardLayout } from '../utils/gridVisibility';
import { useSource } from '../context/SourceContext';
import { StorageService, FeedOrder } from '../services/storage';

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
  return `${order.sortBy}|${order.timeRange}`;
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
  const isRedGifs = activeSource.type === 'redgifs';

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
      try {
        if (pageNum === 1 && !isRefresh) setLoading(true);
        setError(null);

        const feedFilter: SearchFilterConfig = {
          ...DEFAULT_FILTER_CONFIG,
          sortBy: feedOrder.sortBy,
          timeRange: feedOrder.timeRange,
        };
        const newPosts = await booruApi.fetchPosts(pageNum, 24, '', feedFilter);

        // 429/boş sayfada sessizce dur: footer loader takılı kalmasın
        if (newPosts.length === 0 && pageNum > 1) {
          setPage(pageNum - 1);
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

        setPosts((prev) => {
          if (pageNum === 1) return newPosts;
          const existingIds = new Set(prev.map((p) => p.id));
          const uniqueNew = newPosts.filter((p) => !existingIds.has(p.id));
          // API aynı sayfayı döndürdüyse sayacı geri al
          if (uniqueNew.length === 0) {
            setPage(pageNum - 1);
            return prev;
          }
          return [...prev, ...uniqueNew];
        });
      } catch (err: any) {
        console.warn('[FeedScreen] loadPosts error:', err);
        // Yükleme hatasında sayacı geri al ki sonraki kaydırma aynı sayfayı denesin
        if (pageNum > 1) {
          setPage(pageNum - 1);
        } else {
          setError(err?.message || 'Görseller yüklenirken bir hata oluştu.');
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [feedOrder]
  );

  const scrollViewRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const loadMoreGuardRef = useRef(0);
  // Kaynak veya sıra değiştiyse baştan yükle. Saklanan sıra async okunduğu
  // için "hazır" olmadan ilk istek atılmaz (aksi halde her açılışta Trend
  // yüklenip kullanıcının tercihi ikinci turda gelirdi).
  const [feedOrderReady, setFeedOrderReady] = useState(false);
  const feedKey = `${activeSource.id}|${feedOrderKey(feedOrder)}`;

  useEffect(() => {
    StorageService.getFeedOrder().then((saved) => {
      if (saved) setFeedOrder(saved);
      setFeedOrderReady(true);
    });
  }, []);

  useEffect(() => {
    if (!feedOrderReady) return;
    booruApi.resetFeedSeen();
    setPage(1);
    scrollOffsetRef.current = 0;
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
    loadPosts(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feedKey, feedOrderReady]);

  const handleSelectOrder = (order: FeedOrder) => {
    if (feedOrderKey(order) === feedOrderKey(feedOrder)) return;
    Haptics.selectionAsync();
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
    if (loadingMore || loading || refreshing) return;
    // Stale page guard: rapid scroll ateşlerinde çift yükleme olmasın
    loadMoreGuardRef.current += 1;
    if (loadMoreGuardRef.current > 1) {
      loadMoreGuardRef.current -= 1;
      return;
    }
    setLoadingMore(true);
    setPage((p) => p + 1);
    loadPosts(page + 1).finally(() => {
      loadMoreGuardRef.current = 0;
    });
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

  // Liste değişince ilk ekranın videoları hemen oynasın
  useEffect(() => {
    updateVisible(layoutMapRef.current, scrollOffsetRef.current, SCREEN_HEIGHT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts]);

  const handleCardPress = (post: BooruPost) => {
    const idx = posts.findIndex((p) => p.id === post.id);
    if (idx >= 0) {
      pushViewer(posts, idx, [], undefined);
    }
  };

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
            if (isCloseToBottom(nativeEvent)) {
              handleLoadMore();
            }
          }}
          scrollEventThrottle={100}
        >
          {/* 2-Column Masonry Grid */}
          <View style={styles.gridContainer}>
            <View style={styles.column}>
              {leftColumn.map((post) => (
                <PostCard
                  key={`feed-${post.id}`}
                  post={post}
                  onPress={handleCardPress}
                  favoriteIds={favoriteIds}
                  column="left"
                  videoActive={visibleIds.has(post.id)}
                />
              ))}
            </View>
            <View style={styles.column}>
              {rightColumn.map((post) => (
                <PostCard
                  key={`feed-${post.id}`}
                  post={post}
                  onPress={handleCardPress}
                  favoriteIds={favoriteIds}
                  column="right"
                  videoActive={visibleIds.has(post.id)}
                />
              ))}
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
