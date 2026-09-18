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
import { Layers, RefreshCw, AlertCircle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { booruApi } from '../services/booruApi';
import { BooruPost, BooruSource } from '../types/booru';
import { PostCard } from '../components/PostCard';
import { pushViewer } from '../navigation/rootNavigation';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../theme/colors';
import { getMediaHeaders } from '../utils/media';
import { useSource } from '../context/SourceContext';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

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

  const loadPosts = useCallback(
    async (pageNum: number, isRefresh: boolean = false) => {
      try {
        if (pageNum === 1 && !isRefresh) setLoading(true);
        setError(null);

        const newPosts = await booruApi.fetchPosts(pageNum, 24);

        // Pre-warm memory/disk cache with thumbnails
        newPosts.slice(0, 10).forEach((p) => {
          const u = p.previewUrl || p.sampleUrl;
          if (u) {
            Image.prefetch(u, { headers: getMediaHeaders(u) });
          }
        });

        setPosts((prev) => {
          if (pageNum === 1) return newPosts;
          const existingIds = new Set(prev.map((p) => p.id));
          const uniqueNew = newPosts.filter((p) => !existingIds.has(p.id));
          return [...prev, ...uniqueNew];
        });
      } catch (err: any) {
        setError(err?.message || 'Görseller yüklenirken bir hata oluştu.');
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    []
  );

  const scrollViewRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const lastSourceIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastSourceIdRef.current === null) {
      lastSourceIdRef.current = activeSource.id;
      loadPosts(1);
    } else if (lastSourceIdRef.current !== activeSource.id) {
      lastSourceIdRef.current = activeSource.id;
      setPage(1);
      scrollOffsetRef.current = 0;
      loadPosts(1);
    }
  }, [activeSource.id, loadPosts]);

  const handleRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    setPage(1);
    scrollOffsetRef.current = 0;
    await loadPosts(1, true);
  };

  const handleLoadMore = () => {
    if (loadingMore || loading) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    setPage(nextPage);
    loadPosts(nextPage);
  };

  const isCloseToBottom = ({
    layoutMeasurement,
    contentOffset,
    contentSize,
  }: any) => {
    return layoutMeasurement.height + contentOffset.y >= contentSize.height - 400;
  };

  // Masonry 2-column distribution
  const leftColumn: BooruPost[] = [];
  const rightColumn: BooruPost[] = [];
  posts.forEach((post, index) => {
    if (index % 2 === 0) {
      leftColumn.push(post);
    } else {
      rightColumn.push(post);
    }
  });

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
          <Text style={styles.headerSubtitle}>En yeni anime ve çizimler</Text>
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

            {showSourcePicker && activeSource.id !== 'safebooru' && (
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
            if (isCloseToBottom(nativeEvent)) {
              handleLoadMore();
            }
          }}
          scrollEventThrottle={16}
        >
          {/* 2-Column Masonry Grid */}
          <View style={styles.gridContainer}>
            <View style={styles.column}>
              {leftColumn.map((post, index) => (
                <PostCard
                  key={`feed-left-${post.id}-${index}`}
                  post={post}
                  onPress={handleCardPress}
                />
              ))}
            </View>

            <View style={styles.column}>
              {rightColumn.map((post, index) => (
                <PostCard
                  key={`feed-right-${post.id}-${index}`}
                  post={post}
                  onPress={handleCardPress}
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
