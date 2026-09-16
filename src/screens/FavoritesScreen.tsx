import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart, ImageOff, Tag, Pin, Trash2, Search, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { StorageService } from '../services/storage';
import { BackupService } from '../services/backupService';
import { BooruPost } from '../types/booru';
import { PostCard } from '../components/PostCard';
import { TagChip } from '../components/TagChip';
import { ImageViewerModal } from '../components/ImageViewerModal';
import { Colors } from '../theme/colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GOLD_ACCENT = '#F5A623';

interface FavoritesScreenProps {
  isActive?: boolean;
  onSelectTag?: (tag: string, mode?: 'replace' | 'add' | 'exclude') => void;
}

export const FavoritesScreen: React.FC<FavoritesScreenProps> = ({ isActive, onSelectTag }) => {
  const insets = useSafeAreaInsets();
  const [activeSegment, setActiveSegment] = useState<'posts' | 'tags'>('posts');
  const [favorites, setFavorites] = useState<BooruPost[]>([]);
  const [favoriteTags, setFavoriteTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(40);
  const [selectedPostIndex, setSelectedPostIndex] = useState<number | null>(null);

  const loadData = useCallback(async (silent: boolean = false) => {
    try {
      if (!silent && favorites.length === 0 && favoriteTags.length === 0) setLoading(true);
      await BackupService.repairAndNormalizeStoredFavorites();
      const [items, tags] = await Promise.all([
        StorageService.getFavorites(),
        StorageService.getFavoriteTags(),
      ]);
      setFavorites(items);
      setFavoriteTags(tags);
    } catch (e) {
      console.warn('Load favorites error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [favorites.length, favoriteTags.length]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (isActive) {
      loadData(true);
    }
  }, [isActive, loadData]);

  const handleRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    setDisplayLimit(40);
    await loadData(true);
  };

  const handleRemoveTag = async (tag: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await StorageService.removeFavoriteTag(tag);
    setFavoriteTags((prev) => prev.filter((t) => t !== tag));
  };

  const trimmedQuery = searchQuery.trim().toLowerCase();

  // Filtered favorites by tags, post ID, or booru source
  const filteredFavorites = useMemo(() => {
    if (!trimmedQuery) return favorites;
    const terms = trimmedQuery.split(/\s+/).filter(Boolean);

    return favorites.filter((post) => {
      const idStr = String(post.id).toLowerCase();
      const sourceNameStr = (post.sourceName || '').toLowerCase();
      const sourceIdStr = (post.sourceId || '').toLowerCase();
      const allTags = (post.allTags || []).map((t) => t.toLowerCase());

      return terms.every((term) => {
        if (idStr.includes(term)) return true;
        if (sourceNameStr.includes(term) || sourceIdStr.includes(term)) return true;
        return allTags.some((tag) => tag.includes(term));
      });
    });
  }, [favorites, trimmedQuery]);

  // Filtered favorite tags
  const filteredFavoriteTags = useMemo(() => {
    if (!trimmedQuery) return favoriteTags;
    const terms = trimmedQuery.split(/\s+/).filter(Boolean);

    return favoriteTags.filter((tag) => {
      const tagLower = tag.toLowerCase();
      return terms.every((term) => tagLower.includes(term));
    });
  }, [favoriteTags, trimmedQuery]);

  // 2-column masonry distribution with pagination limit
  const visibleFavorites = filteredFavorites.slice(0, displayLimit);
  const leftColumn: BooruPost[] = [];
  const rightColumn: BooruPost[] = [];
  visibleFavorites.forEach((post, index) => {
    if (index % 2 === 0) {
      leftColumn.push(post);
    } else {
      rightColumn.push(post);
    }
  });

  const handleCardPress = (post: BooruPost) => {
    const idx = filteredFavorites.findIndex((p) => p.id === post.id);
    setSelectedPostIndex(idx >= 0 ? idx : 0);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Favoriler</Text>
          <Text style={styles.headerSubtitle}>
            {activeSegment === 'posts'
              ? trimmedQuery
                ? `${filteredFavorites.length} / ${favorites.length} görsel`
                : `Kaydedilen görseller (${favorites.length})`
              : trimmedQuery
                ? `${filteredFavoriteTags.length} / ${favoriteTags.length} etiket`
                : `Favori etiketler (${favoriteTags.length})`}
          </Text>
        </View>

        <View style={styles.favBadge}>
          <Heart size={16} color="#FF4D4F" fill="#FF4D4F" />
        </View>
      </View>

      {/* Segment Switcher [ Görseller | Etiketler ] */}
      <View style={styles.segmentWrapper}>
        <View style={styles.segmentContainer}>
          <TouchableOpacity
            style={[styles.segmentBtn, activeSegment === 'posts' && styles.segmentBtnActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveSegment('posts');
            }}
          >
            <Heart
              size={14}
              color={activeSegment === 'posts' ? '#FFFFFF' : Colors.dark.textMuted}
              fill={activeSegment === 'posts' ? '#FF4D4F' : 'transparent'}
            />
            <Text
              style={[
                styles.segmentText,
                activeSegment === 'posts' && styles.segmentTextActive,
              ]}
            >
              Görseller ({favorites.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.segmentBtn, activeSegment === 'tags' && styles.segmentBtnActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveSegment('tags');
            }}
          >
            <Pin
              size={14}
              color={activeSegment === 'tags' ? GOLD_ACCENT : Colors.dark.textMuted}
            />
            <Text
              style={[
                styles.segmentText,
                activeSegment === 'tags' && styles.segmentTextActive,
              ]}
            >
              Etiketler ({favoriteTags.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Search size={16} color={searchQuery ? GOLD_ACCENT : Colors.dark.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={
              activeSegment === 'posts'
                ? 'Favorilerde ara... (etiket veya ID)'
                : 'Favori etiketlerde ara...'
            }
            placeholderTextColor={Colors.dark.textMuted}
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              setDisplayLimit(40);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="never"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity
              style={styles.clearBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSearchQuery('');
                setDisplayLimit(40);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={16} color={Colors.dark.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={Colors.dark.primary} />
        </View>
      ) : activeSegment === 'tags' ? (
        /* FAVORITE TAGS LIST */
        favoriteTags.length === 0 ? (
          <View style={styles.centerContainer}>
            <View style={styles.emptyIconCircle}>
              <Pin size={38} color={GOLD_ACCENT} />
            </View>
            <Text style={styles.emptyTitle}>Favori Etiket Yok</Text>
            <Text style={styles.emptyText}>
              Görsel detayından veya arama ekranından etiketleri favorileyebilirsiniz.
            </Text>
          </View>
        ) : filteredFavoriteTags.length === 0 ? (
          <View style={styles.centerContainer}>
            <View style={styles.emptyIconCircle}>
              <Search size={36} color={GOLD_ACCENT} />
            </View>
            <Text style={styles.emptyTitle}>Etiket Bulunamadı</Text>
            <Text style={styles.emptyText}>
              "{searchQuery}" aramasıyla eşleşen favori etiket bulunamadı.
            </Text>
            <TouchableOpacity
              style={styles.clearFilterBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSearchQuery('');
              }}
            >
              <Text style={styles.clearFilterBtnText}>Aramayı Temizle</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={Colors.dark.primary}
              />
            }
          >
            <View style={styles.tagsGridCard}>
              {filteredFavoriteTags.map((tag, idx) => (
                <View key={`fav-tag-list-${tag}-${idx}`} style={styles.favTagRow}>
                  <TouchableOpacity
                    style={styles.favTagLeft}
                    onPress={() => onSelectTag?.(tag)}
                  >
                    <Pin size={16} color={GOLD_ACCENT} />
                    <Text style={styles.favTagName}>{tag}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.favTagRemoveBtn}
                    onPress={() => handleRemoveTag(tag)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Trash2 size={16} color={Colors.dark.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </ScrollView>
        )
      ) : (
        /* FAVORITE POSTS MASONRY GRID */
        favorites.length === 0 ? (
          <View style={styles.centerContainer}>
            <View style={styles.emptyIconCircle}>
              <ImageOff size={38} color={Colors.dark.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Henüz Favori Yok</Text>
            <Text style={styles.emptyText}>
              Beğendiğin görselleri kalp ikonuna basarak buraya kaydedebilirsin.
            </Text>
          </View>
        ) : filteredFavorites.length === 0 ? (
          <View style={styles.centerContainer}>
            <View style={styles.emptyIconCircle}>
              <Search size={36} color={Colors.dark.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Eşleşen Favori Bulunamadı</Text>
            <Text style={styles.emptyText}>
              "{searchQuery}" aramasıyla eşleşen favori görsel bulunamadı. Farklı bir etiket veya ID deneyin.
            </Text>
            <TouchableOpacity
              style={styles.clearFilterBtn}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSearchQuery('');
              }}
            >
              <Text style={styles.clearFilterBtnText}>Aramayı Temizle</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={Colors.dark.primary}
              />
            }
            onScroll={({ nativeEvent }) => {
              const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
              if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 400) {
                if (displayLimit < filteredFavorites.length) {
                  setDisplayLimit((prev) => prev + 40);
                }
              }
            }}
            scrollEventThrottle={300}
          >
            <View style={styles.gridContainer}>
              <View style={styles.column}>
                {leftColumn.map((post, index) => (
                  <PostCard
                    key={`fav-left-${post.id}-${index}`}
                    post={post}
                    onPress={handleCardPress}
                  />
                ))}
              </View>
              <View style={styles.column}>
                {rightColumn.map((post, index) => (
                  <PostCard
                    key={`fav-right-${post.id}-${index}`}
                    post={post}
                    onPress={handleCardPress}
                  />
                ))}
              </View>
            </View>
          </ScrollView>
        )
      )}

      {/* Full Detail Gallery Viewer Modal */}
      <ImageViewerModal
        posts={filteredFavorites}
        initialIndex={selectedPostIndex ?? 0}
        visible={selectedPostIndex !== null}
        onClose={() => setSelectedPostIndex(null)}
        onTagPress={(tag) => {
          setSelectedPostIndex(null);
          onSelectTag?.(tag, 'replace');
        }}
        onAddTagToSearch={(tag) => {
          setSelectedPostIndex(null);
          onSelectTag?.(tag, 'add');
        }}
        onExcludeTagFromSearch={(tag) => {
          setSelectedPostIndex(null);
          onSelectTag?.(tag, 'exclude');
        }}
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.dark.text,
  },
  headerSubtitle: {
    fontSize: 13,
    color: Colors.dark.textMuted,
    marginTop: 2,
  },
  favBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 77, 79, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 79, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentWrapper: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  segmentContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    padding: 3,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 11,
    gap: 6,
  },
  segmentBtnActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.textMuted,
  },
  segmentTextActive: {
    color: '#FFFFFF',
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
    paddingHorizontal: 36,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.dark.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.dark.cardBorder,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark.text,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.dark.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
  tagsGridCard: {
    backgroundColor: '#1A1C22',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2E38',
    overflow: 'hidden',
  },
  favTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  favTagLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  favTagName: {
    fontSize: 15,
    fontWeight: '600',
    color: GOLD_ACCENT,
  },
  favTagRemoveBtn: {
    padding: 6,
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181A22',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: '#292D3B',
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    color: Colors.dark.text,
    fontSize: 13,
  },
  clearBtn: {
    padding: 4,
  },
  clearFilterBtn: {
    marginTop: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  clearFilterBtnText: {
    color: Colors.dark.text,
    fontSize: 13,
    fontWeight: '600',
  },
});
