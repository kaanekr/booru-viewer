import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Heart,
  ImageOff,
  Tag,
  Pin,
  Trash2,
  Search,
  X,
  Layers,
  Sparkles,
  SlidersHorizontal,
  ArrowUpDown,
  Calendar,
  Film,
  Flame,
  Check,
  RotateCcw,
  Clock,
  History,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { StorageService } from '../services/storage';
import { BackupService } from '../services/backupService';
import { AVAILABLE_SOURCES } from '../services/sources';
import { BooruPost, TagCategory } from '../types/booru';
import { asStrOr, lower, onlyStrings } from '../utils/guards';
import { PostCard } from '../components/PostCard';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import { pushViewer } from '../navigation/rootNavigation';
import { Colors, TagColors } from '../theme/colors';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GOLD_ACCENT = '#F5A623';

interface FavoritesScreenProps {
  navigation?: any;
  isActive?: boolean;
  onSelectTag?: (tag: string, mode?: 'replace' | 'add' | 'exclude') => void;
}

export const FavoritesScreen: React.FC<FavoritesScreenProps> = ({
  navigation: propNavigation,
  isActive,
  onSelectTag,
}) => {
  const hookNavigation = useNavigation<any>();
  const navigation = propNavigation ?? hookNavigation;
  const isFocused = useIsFocused();
  const effectiveIsActive = isActive ?? isFocused;

  const handleSelectTag = (tag: string, mode?: 'replace' | 'add' | 'exclude') => {
    if (onSelectTag) {
      onSelectTag(tag, mode);
    } else if (navigation?.navigate) {
      navigation.navigate('Search', { tag, mode: mode ?? 'replace' });
    }
  };

  const insets = useSafeAreaInsets();
  const [activeSegment, setActiveSegment] = useState<'posts' | 'tags' | 'history'>('posts');
  const [favorites, setFavorites] = useState<BooruPost[]>([]);
  const [favoriteTags, setFavoriteTags] = useState<string[]>([]);
  const [recentViews, setRecentViews] = useState<BooruPost[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagMatchMode, setTagMatchMode] = useState<'AND' | 'OR'>('AND');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'video' | 'image' | 'animated'>('all');
  const [ratingFilter, setRatingFilter] = useState<'all' | 'safe' | 'questionable' | 'explicit'>('all');
  const [sortBy, setSortBy] = useState<'fav_date' | 'score' | 'id_desc' | 'id_asc'>('fav_date');
  const [showFilterSheet, setShowFilterSheet] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(40);
  const [historyLimit, setHistoryLimit] = useState(40);

  const loadRecentViews = useCallback(async () => {
    try {
      const views = await StorageService.getRecentViews();
      setRecentViews(views);
    } catch (e) {
      console.warn('Load recent views error:', e);
    }
  }, []);

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
    loadRecentViews();
  }, [loadData, loadRecentViews]);

  useEffect(() => {
    if (effectiveIsActive) {
      loadData(true);
      loadRecentViews();
    }
  }, [effectiveIsActive, loadData, loadRecentViews]);

  const handleRefresh = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    setDisplayLimit(40);
    setHistoryLimit(40);
    await Promise.all([loadData(true), loadRecentViews()]);
    setRefreshing(false);
  };

  const handleClearRecentViews = () => {
    Alert.alert(
      'Geçmişi Temizle',
      'Son görüntülenen gönderilerin tümünü silmek istediğinizden emin misiniz?',
      [
        { text: 'İptal', style: 'cancel' },
        {
          text: 'Temizle',
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await StorageService.clearRecentViews();
            setRecentViews([]);
            setHistoryLimit(40);
          },
        },
      ]
    );
  };

  const handleRemoveFavoriteTag = async (tag: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await StorageService.removeFavoriteTag(tag);
    setFavoriteTags((prev) => prev.filter((t) => t !== tag));
  };

  // Favorilerdeki tüm gönderilerden etiket sıklığı ve kategori haritası
  const tagStats = useMemo(() => {
    const counts = new Map<string, number>();
    const categories = new Map<string, TagCategory>();

    favorites.forEach((post) => {
      if (post.tags && typeof post.tags === 'object') {
        onlyStrings(post.tags.artist).forEach((t) => {
          const k = t.trim().toLowerCase();
          if (k) categories.set(k, 'artist');
        });
        onlyStrings(post.tags.character).forEach((t) => {
          const k = t.trim().toLowerCase();
          if (k) categories.set(k, 'character');
        });
        onlyStrings(post.tags.copyright).forEach((t) => {
          const k = t.trim().toLowerCase();
          if (k) categories.set(k, 'copyright');
        });
        onlyStrings(post.tags.meta).forEach((t) => {
          const k = t.trim().toLowerCase();
          if (k) categories.set(k, 'meta');
        });
        onlyStrings(post.tags.general).forEach((t) => {
          const k = t.trim().toLowerCase();
          if (k && !categories.has(k)) categories.set(k, 'general');
        });
      }

      onlyStrings(post.allTags).forEach((t) => {
        const clean = t.trim().toLowerCase();
        if (clean) {
          counts.set(clean, (counts.get(clean) || 0) + 1);
        }
      });
    });

    return { counts, categories };
  }, [favorites]);

  // Fav ID seti: kartlar rozet için storage'a sormaz — anında + çökmesiz
  const favoriteIdSet = useMemo(() => new Set(favorites.map((p) => p.id)), [favorites]);

  // Favorilerde bulunan kaynaklar ve görsel sayıları (kanonik isimlerle)
  const sourceList = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();

    favorites.forEach((post) => {
      const rawSid = lower(post.sourceId) || lower(post.sourceName) || 'unknown';
      const canonical = AVAILABLE_SOURCES.find(
        (s) => s.id.toLowerCase() === rawSid || s.name.toLowerCase() === rawSid
      );
      const sid = canonical ? canonical.id.toLowerCase() : rawSid;
      const sname = canonical ? canonical.name : asStrOr(post.sourceName, asStrOr(post.sourceId, 'Diğer'));
      const existing = map.get(sid);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(sid, { id: sid, name: sname, count: 1 });
      }
    });

    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [favorites]);

  const trimmedQuery = searchQuery.trim().toLowerCase();

  // Otomatik tamamlama / Öneri listesi
  const suggestions = useMemo(() => {
    if (activeSegment !== 'posts' || trimmedQuery.length < 2) return [];

    const list: { name: string; count: number; category: TagCategory }[] = [];
    const queryNormalized = trimmedQuery.replace(/_/g, ' ');

    tagStats.counts.forEach((count, name) => {
      if (selectedTags.includes(name)) return;

      const nameNormalized = name.replace(/_/g, ' ');
      if (name.includes(trimmedQuery) || nameNormalized.includes(queryNormalized)) {
        list.push({
          name,
          count,
          category: tagStats.categories.get(name) || 'general',
        });
      }
    });

    list.sort((a, b) => {
      const aStarts = a.name.startsWith(trimmedQuery);
      const bStarts = b.name.startsWith(trimmedQuery);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return b.count - a.count;
    });

    return list.slice(0, 10);
  }, [activeSegment, trimmedQuery, tagStats, selectedTags]);

  // Çoklu etiket, kaynak, puan, tür, rating ve arama metnine göre filtrelenmiş favoriler
  const filteredFavorites = useMemo(() => {
    let result = favorites.filter((post) => {
      // 1. Kaynak Filtresi
      if (selectedSource !== 'all') {
        const postSourceId = lower(post.sourceId);
        const postSourceName = lower(post.sourceName);
        if (postSourceId !== selectedSource && postSourceName !== selectedSource) {
          return false;
        }
      }

      // 2. Medya Türü Filtresi
      if (mediaTypeFilter !== 'all') {
        const rawMedia = lower(post.originalUrl) || lower(post.sampleUrl) || lower(post.previewUrl) || '';
        const ext = lower(post.fileExt);
        const isVid = ['mp4', 'webm', 'mov', 'm4v'].includes(ext) || rawMedia.endsWith('.mp4') || rawMedia.endsWith('.webm') || rawMedia.endsWith('.mov');
        const isGif = ext === 'gif' || rawMedia.endsWith('.gif');
        if (mediaTypeFilter === 'video' && !isVid) return false;
        if (mediaTypeFilter === 'animated' && !isGif && !isVid) return false;
        if (mediaTypeFilter === 'image' && (isVid || isGif)) return false;
      }

      // 3. Rating / Güvenlik Filtresi
      if (ratingFilter !== 'all') {
        const r = lower(post.rating);
        if (ratingFilter === 'safe' && r !== 's' && r !== 'safe' && r !== 'general') return false;
        if (ratingFilter === 'questionable' && r !== 'q' && r !== 'questionable' && r !== 'sensitive') return false;
        if (ratingFilter === 'explicit' && r !== 'e' && r !== 'explicit') return false;
      }

      const postAllTags = onlyStrings(post.allTags).map((t) => t.toLowerCase());

      // 4. Seçili Çoklu Etiketler Filtresi (AND veya OR modu)
      if (selectedTags.length > 0) {
        if (tagMatchMode === 'AND') {
          const hasAllSelected = selectedTags.every((selectedTag) => {
            const sel = selectedTag.toLowerCase();
            const selNormalized = sel.replace(/_/g, ' ');
            return postAllTags.some((t) => {
              return t === sel || t.replace(/_/g, ' ') === selNormalized || t.includes(sel);
            });
          });
          if (!hasAllSelected) return false;
        } else {
          // OR modu
          const hasAnySelected = selectedTags.some((selectedTag) => {
            const sel = selectedTag.toLowerCase();
            const selNormalized = sel.replace(/_/g, ' ');
            return postAllTags.some((t) => {
              return t === sel || t.replace(/_/g, ' ') === selNormalized || t.includes(sel);
            });
          });
          if (!hasAnySelected) return false;
        }
      }

      // 5. Normal Metin Arama Kutusu Filtresi (tag/source/id desteği)
      if (trimmedQuery) {
        const terms = trimmedQuery.split(/\s+/).filter(Boolean);
        const idStr = String(post.id).toLowerCase();
        const sourceNameStr = (post.sourceName || '').toLowerCase();
        const sourceIdStr = (post.sourceId || '').toLowerCase();

        const matchesQuery = terms.every((term) => {
          if (idStr.includes(term)) return true;
          if (sourceNameStr.includes(term) || sourceIdStr.includes(term)) return true;
          return postAllTags.some((tag) => tag.includes(term));
        });

        if (!matchesQuery) return false;
      }

      return true;
    });

    // 6. Sıralama
    if (sortBy === 'score') {
      result = [...result].sort((a, b) => (b.score || 0) - (a.score || 0));
    } else if (sortBy === 'id_desc') {
      result = [...result].sort((a, b) => Number(b.id || 0) - Number(a.id || 0));
    } else if (sortBy === 'id_asc') {
      result = [...result].sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    }

    return result;
  }, [favorites, selectedSource, mediaTypeFilter, ratingFilter, selectedTags, tagMatchMode, trimmedQuery, sortBy]);

  // Filtrelenmiş favori etiketler (Etiketler sekmesi için)
  const filteredFavoriteTags = useMemo(() => {
    if (!trimmedQuery) return favoriteTags;
    const terms = trimmedQuery.split(/\s+/).filter(Boolean);

    return favoriteTags.filter((tag) => {
      const tagLower = tag.toLowerCase();
      return terms.every((term) => tagLower.includes(term));
    });
  }, [favoriteTags, trimmedQuery]);

  // Etiket seçme & çipe dönüştürme
  const handleAddSelectedTag = (tag: string) => {
    const normalized = tag.trim().toLowerCase();
    if (!normalized) return;
    Haptics.selectionAsync();
    if (!selectedTags.includes(normalized)) {
      setSelectedTags((prev) => [...prev, normalized]);
    }
    setSearchQuery('');
    setDisplayLimit(40);
    Keyboard.dismiss();
    setIsInputFocused(false);
  };

  // Klavyeden arama metnini onaylayınca çip olarak ekleme
  const handleSubmitSearch = () => {
    if (!trimmedQuery) return;
    const terms = trimmedQuery.split(/\s+/).filter(Boolean);
    if (terms.length > 0) {
      Haptics.selectionAsync();
      setSelectedTags((prev) => {
        const next = [...prev];
        terms.forEach((term) => {
          if (!next.includes(term)) next.push(term);
        });
        return next;
      });
      setSearchQuery('');
      setDisplayLimit(40);
      Keyboard.dismiss();
      setIsInputFocused(false);
    }
  };

  // Tekil çip kaldırma
  const handleRemoveSelectedTag = (tag: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTags((prev) => prev.filter((t) => t !== tag));
    setDisplayLimit(40);
  };

  // Tüm etiketleri temizleme
  const handleClearAllSelectedTags = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTags([]);
    setDisplayLimit(40);
  };

  // Tüm filtreleri (etiket, kaynak, metin, sıralama, rating, tür) sıfırlama
  const handleClearAllFilters = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedTags([]);
    setSelectedSource('all');
    setMediaTypeFilter('all');
    setRatingFilter('all');
    setSortBy('fav_date');
    setTagMatchMode('AND');
    setSearchQuery('');
    setDisplayLimit(40);
  };

  const hasActiveFilters =
    selectedTags.length > 0 ||
    selectedSource !== 'all' ||
    trimmedQuery.length > 0 ||
    mediaTypeFilter !== 'all' ||
    ratingFilter !== 'all' ||
    sortBy !== 'fav_date';

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

  const handleCardPress = useCallback((post: BooruPost) => {
    const idx = filteredFavorites.findIndex((p) => p.id === post.id);
    if (idx >= 0) {
      pushViewer(filteredFavorites, idx, [], undefined);
    }
  }, [filteredFavorites]);

  const handleHistoryCardPress = useCallback((post: BooruPost) => {
    const idx = recentViews.findIndex((p) => p.id === post.id);
    if (idx >= 0) {
      pushViewer(recentViews, idx, [], undefined);
    }
  }, [recentViews]);

  // Paginated visible history slice
  const visibleRecentViews = useMemo(
    () => recentViews.slice(0, historyLimit),
    [recentViews, historyLimit]
  );

  const handleLoadMoreHistory = useCallback(() => {
    if (historyLimit < recentViews.length) {
      setHistoryLimit((prev) => prev + 40);
    }
  }, [historyLimit, recentViews.length]);

  const renderHistoryItem = useCallback(
    ({ item }: { item: BooruPost }) => (
      <PostCard
        post={item}
        onPress={handleHistoryCardPress}
        favoriteIds={favoriteIdSet}
      />
    ),
    [handleHistoryCardPress, favoriteIdSet]
  );

  const historyKeyExtractor = useCallback(
    (item: BooruPost, index: number) => `hist-${item.id}-${index}`,
    []
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Favoriler</Text>
          <Text style={styles.headerSubtitle}>
            {activeSegment === 'posts'
              ? hasActiveFilters
                ? `${filteredFavorites.length} / ${favorites.length} görsel filtrelendi`
                : `Kaydedilen görseller (${favorites.length})`
              : activeSegment === 'tags'
                ? trimmedQuery
                  ? `${filteredFavoriteTags.length} / ${favoriteTags.length} etiket`
                  : `Favori etiketler (${favoriteTags.length})`
                : `Son görüntülenen görseller (${recentViews.length})`}
          </Text>
        </View>

        {activeSegment === 'history' ? (
          recentViews.length > 0 ? (
            <TouchableOpacity
              style={styles.clearHeaderBtn}
              onPress={handleClearRecentViews}
              activeOpacity={0.7}
            >
              <Trash2 size={14} color="#FF6B6B" />
              <Text style={styles.clearHeaderBtnText}>Temizle</Text>
            </TouchableOpacity>
          ) : null
        ) : (
          <View style={styles.favBadge}>
            <Heart size={16} color="#FF4D4F" fill="#FF4D4F" />
          </View>
        )}
      </View>

      {/* Segment Switcher [ Görseller | Etiketler | Geçmiş ] */}
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
              numberOfLines={1}
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
              numberOfLines={1}
            >
              Etiketler ({favoriteTags.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.segmentBtn, activeSegment === 'history' && styles.segmentBtnActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveSegment('history');
              setHistoryLimit(40);
              loadRecentViews();
            }}
          >
            <Clock
              size={14}
              color={activeSegment === 'history' ? '#4DABF7' : Colors.dark.textMuted}
            />
            <Text
              style={[
                styles.segmentText,
                activeSegment === 'history' && styles.segmentTextActive,
              ]}
              numberOfLines={1}
            >
              Geçmiş ({recentViews.length})
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar & Auto-Suggestions Dropdown (Sadece posts segmentinde) */}
      {activeSegment === 'posts' && (
        <View style={styles.searchContainer}>
          <View style={styles.searchBarRow}>
            <View style={[styles.searchBar, isInputFocused && styles.searchBarFocused]}>
              <Search
                size={16}
                color={isInputFocused || searchQuery ? GOLD_ACCENT : Colors.dark.textMuted}
              />
              <TextInput
                style={styles.searchInput}
                placeholder="Favorilerde ara... (Enter ile etiket ekle)"
                placeholderTextColor={Colors.dark.textMuted}
                value={searchQuery}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => {
                  // Öneri listesine dokunulabilmesi için kısa gecikme
                  setTimeout(() => setIsInputFocused(false), 220);
                }}
                onChangeText={(text) => {
                  setSearchQuery(text);
                  setDisplayLimit(40);
                }}
                onSubmitEditing={handleSubmitSearch}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
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

            {/* Gelişmiş Filtreleme Butonu */}
            <TouchableOpacity
              style={[
                styles.filterToggleBtn,
                (mediaTypeFilter !== 'all' || ratingFilter !== 'all' || sortBy !== 'fav_date' || tagMatchMode !== 'AND' || selectedSource !== 'all') &&
                  styles.filterToggleBtnActive,
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                setShowFilterSheet(true);
              }}
              activeOpacity={0.7}
            >
              <SlidersHorizontal
                size={18}
                color={
                  mediaTypeFilter !== 'all' || ratingFilter !== 'all' || sortBy !== 'fav_date' || tagMatchMode !== 'AND' || selectedSource !== 'all'
                    ? GOLD_ACCENT
                    : '#FFFFFF'
                }
              />
              {(mediaTypeFilter !== 'all' || ratingFilter !== 'all' || sortBy !== 'fav_date' || tagMatchMode !== 'AND' || selectedSource !== 'all') && (
                <View style={styles.filterActiveDot} />
              )}
            </TouchableOpacity>
          </View>

          {/* Otomatik Tamamlama / Öneri Listesi (Dropdown Overlay) */}
          {isInputFocused && suggestions.length > 0 && (
            <View style={styles.suggestionsDropdown}>
              <View style={styles.suggestionsHeader}>
                <Sparkles size={13} color={GOLD_ACCENT} />
                <Text style={styles.suggestionsHeaderText}>
                  Favorilerdeki Eşleşen Etiketler ({suggestions.length})
                </Text>
              </View>
              <ScrollView
                style={styles.suggestionsScroll}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {suggestions.map((item, idx) => {
                  const categoryColor = TagColors[item.category] || TagColors.general;
                  return (
                    <TouchableOpacity
                      key={`fav-sug-${item.name}-${idx}`}
                      style={styles.suggestionRow}
                      activeOpacity={0.7}
                      onPress={() => handleAddSelectedTag(item.name)}
                    >
                      <View style={styles.suggestionLeft}>
                        <Tag size={13} color={categoryColor.text} />
                        <Text
                          style={[styles.suggestionText, { color: categoryColor.text }]}
                          numberOfLines={1}
                        >
                          {item.name.replace(/_/g, ' ')}
                        </Text>
                      </View>
                      <View style={styles.suggestionBadge}>
                        <Text style={styles.suggestionBadgeText}>
                          {item.count} görsel
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}
        </View>
      )}

      {/* Seçilen Etiketler / Çip Listesi (Selected Tags Chips) */}
      {activeSegment === 'posts' && (selectedTags.length > 0 || tagMatchMode === 'OR') && (
        <View style={styles.selectedTagsContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.selectedTagsContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* AND / OR Eşleşme Modu Değiştirici */}
            {selectedTags.length > 1 && (
              <TouchableOpacity
                style={styles.modeToggleChip}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setTagMatchMode((prev) => (prev === 'AND' ? 'OR' : 'AND'));
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.modeToggleLabel}>Eşleşme:</Text>
                <Text style={styles.modeToggleValue}>
                  {tagMatchMode === 'AND' ? 'VE (Tümü)' : 'VEYA (Herhangi)'}
                </Text>
              </TouchableOpacity>
            )}

            {selectedTags.map((tag) => (
              <View key={`selected-chip-${tag}`} style={styles.selectedTagChip}>
                <Tag size={11} color={GOLD_ACCENT} style={styles.selectedTagIcon} />
                <Text style={styles.selectedTagText} numberOfLines={1}>
                  {tag.replace(/_/g, ' ')}
                </Text>
                <TouchableOpacity
                  onPress={() => handleRemoveSelectedTag(tag)}
                  style={styles.selectedTagRemoveBtn}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <X size={12} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            ))}

            {selectedTags.length > 0 && (
              <TouchableOpacity
                style={styles.clearAllTagsBtn}
                onPress={handleClearAllSelectedTags}
                activeOpacity={0.7}
              >
                <Trash2 size={12} color="#FF6B6B" />
                <Text style={styles.clearAllTagsText}>Tümünü Temizle</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        </View>
      )}

      {/* Kaynak Filtre Çipleri (Source Pills) */}
      {activeSegment === 'posts' && favorites.length > 0 && sourceList.length > 0 && (
        <View style={styles.sourcesContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.sourcesContent}
          >
            {/* Tümü Seçeneği */}
            <TouchableOpacity
              style={[
                styles.sourcePill,
                selectedSource === 'all' && styles.sourcePillActive,
              ]}
              onPress={() => {
                Haptics.selectionAsync();
                setSelectedSource('all');
                setDisplayLimit(40);
              }}
              activeOpacity={0.7}
            >
              <Layers
                size={12}
                color={selectedSource === 'all' ? '#111216' : Colors.dark.textSecondary}
              />
              <Text
                style={[
                  styles.sourcePillText,
                  selectedSource === 'all' && styles.sourcePillTextActive,
                ]}
              >
                Tümü ({favorites.length})
              </Text>
            </TouchableOpacity>

            {/* Kaynak Bazlı Butonlar */}
            {sourceList.map((source) => {
              const isSelected = selectedSource === source.id;
              return (
                <TouchableOpacity
                  key={`fav-source-${source.id}`}
                  style={[
                    styles.sourcePill,
                    isSelected && styles.sourcePillActive,
                  ]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSelectedSource(isSelected ? 'all' : source.id);
                    setDisplayLimit(40);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.sourcePillText,
                      isSelected && styles.sourcePillTextActive,
                    ]}
                  >
                    {source.name} ({source.count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

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
                    onPress={() => handleSelectTag(tag)}
                  >
                    <Pin size={16} color={GOLD_ACCENT} />
                    <Text style={styles.favTagName}>{tag}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.favTagRemoveBtn}
                    onPress={() => handleRemoveFavoriteTag(tag)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Trash2 size={16} color={Colors.dark.textMuted} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </ScrollView>
        )
      ) : activeSegment === 'history' ? (
        /* RECENT VIEWS VIRTUALIZED FLATLIST GRID */
        recentViews.length === 0 ? (
          <View style={styles.centerContainer}>
            <View style={styles.emptyIconCircle}>
              <Clock size={38} color={Colors.dark.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Görüntüleme Geçmişi Boş</Text>
            <Text style={styles.emptyText}>
              Görüntülediğiniz gönderiler otomatik olarak burada listelenir.
            </Text>
          </View>
        ) : (
          <FlatList
            style={styles.scrollView}
            data={visibleRecentViews}
            keyExtractor={historyKeyExtractor}
            numColumns={2}
            columnWrapperStyle={styles.columnWrapper}
            contentContainerStyle={styles.scrollContent}
            renderItem={renderHistoryItem}
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            windowSize={5}
            removeClippedSubviews={Platform.OS === 'android'}
            onEndReached={handleLoadMoreHistory}
            onEndReachedThreshold={0.5}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={Colors.dark.primary}
              />
            }
          />
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
              {hasActiveFilters
                ? 'Seçtiğiniz filtreler veya etiketlerle eşleşen kayıtlı görsel bulunamadı.'
                : 'Aradığınız kriterlere uygun favori görsel bulunamadı.'}
            </Text>
            {hasActiveFilters && (
              <TouchableOpacity
                style={styles.clearFilterBtn}
                onPress={handleClearAllFilters}
              >
                <Text style={styles.clearFilterBtnText}>Filtreleri Sıfırla</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
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
                    showFavoriteBadge={false}
                  />
                ))}
              </View>
              <View style={styles.column}>
                {rightColumn.map((post, index) => (
                  <PostCard
                    key={`fav-right-${post.id}-${index}`}
                    post={post}
                    onPress={handleCardPress}
                    showFavoriteBadge={false}
                  />
                ))}
              </View>
            </View>
          </ScrollView>
        )
      )}

      {/* Gelişmiş Filtreler Modal / Alt Menü */}
      <Modal
        visible={showFilterSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFilterSheet(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowFilterSheet(false)}
        >
          <View
            style={styles.modalContent}
            onStartShouldSetResponder={() => true}
          >
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleRow}>
                <SlidersHorizontal size={18} color={GOLD_ACCENT} />
                <Text style={styles.modalTitle}>Favori Filtreleri</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowFilterSheet(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <X size={20} color={Colors.dark.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={true}
              style={styles.modalScroll}
              contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) + 16 }}
            >
              {/* Sunucu / Kaynak Filtresi */}
              <Text style={styles.filterSectionTitle}>Sunucu</Text>
              <View style={styles.filterOptionsGrid}>
                <TouchableOpacity
                  style={[styles.filterChoicePill, selectedSource === 'all' && styles.filterChoicePillActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSelectedSource('all');
                    setDisplayLimit(40);
                  }}
                >
                  <Layers size={13} color={selectedSource === 'all' ? '#111216' : Colors.dark.textSecondary} />
                  <Text style={[styles.filterChoiceText, selectedSource === 'all' && styles.filterChoiceTextActive]}>
                    Tümü ({favorites.length})
                  </Text>
                  {selectedSource === 'all' && <Check size={12} color="#111216" style={{ marginLeft: 2 }} />}
                </TouchableOpacity>
                {sourceList.map((source) => {
                  const isSel = selectedSource === source.id;
                  return (
                    <TouchableOpacity
                      key={`fav-modal-source-${source.id}`}
                      style={[styles.filterChoicePill, isSel && styles.filterChoicePillActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedSource(isSel ? 'all' : source.id);
                        setDisplayLimit(40);
                      }}
                    >
                      <Text style={[styles.filterChoiceText, isSel && styles.filterChoiceTextActive]}>
                        {source.name} ({source.count})
                      </Text>
                      {isSel && <Check size={12} color="#111216" style={{ marginLeft: 2 }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Sıralama Ölçütü */}
              <Text style={styles.filterSectionTitle}>Sıralama</Text>
              <View style={styles.filterOptionsGrid}>
                {[
                  { id: 'fav_date', label: 'Eklenme Tarihi', icon: Calendar },
                  { id: 'score', label: 'En Yüksek Puan', icon: Flame },
                  { id: 'id_desc', label: 'ID (Yeni > Eski)', icon: ArrowUpDown },
                  { id: 'id_asc', label: 'ID (Eski > Yeni)', icon: ArrowUpDown },
                ].map((item) => {
                  const IconCmp = item.icon;
                  const isSel = sortBy === item.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.filterChoicePill, isSel && styles.filterChoicePillActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSortBy(item.id as any);
                      }}
                    >
                      <IconCmp size={13} color={isSel ? '#111216' : Colors.dark.textSecondary} />
                      <Text style={[styles.filterChoiceText, isSel && styles.filterChoiceTextActive]}>
                        {item.label}
                      </Text>
                      {isSel && <Check size={12} color="#111216" style={{ marginLeft: 2 }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Medya Türü */}
              <Text style={styles.filterSectionTitle}>Medya Türü</Text>
              <View style={styles.filterOptionsGrid}>
                {[
                  { id: 'all', label: 'Tümü' },
                  { id: 'image', label: 'Fotoğraf' },
                  { id: 'video', label: 'Video' },
                  { id: 'animated', label: 'GIF / Animasyon' },
                ].map((item) => {
                  const isSel = mediaTypeFilter === item.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.filterChoicePill, isSel && styles.filterChoicePillActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setMediaTypeFilter(item.id as any);
                      }}
                    >
                      <Text style={[styles.filterChoiceText, isSel && styles.filterChoiceTextActive]}>
                        {item.label}
                      </Text>
                      {isSel && <Check size={12} color="#111216" style={{ marginLeft: 2 }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Güvenlik / Rating */}
              <Text style={styles.filterSectionTitle}>İçerik Derecelendirmesi</Text>
              <View style={styles.filterOptionsGrid}>
                {[
                  { id: 'all', label: 'Tümü' },
                  { id: 'safe', label: 'Safe (Güvenli)' },
                  { id: 'questionable', label: 'Questionable' },
                  { id: 'explicit', label: 'Explicit (18+)' },
                ].map((item) => {
                  const isSel = ratingFilter === item.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.filterChoicePill, isSel && styles.filterChoicePillActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setRatingFilter(item.id as any);
                      }}
                    >
                      <Text style={[styles.filterChoiceText, isSel && styles.filterChoiceTextActive]}>
                        {item.label}
                      </Text>
                      {isSel && <Check size={12} color="#111216" style={{ marginLeft: 2 }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Etiket Eşleşme Mantığı */}
              <Text style={styles.filterSectionTitle}>Çoklu Etiket Mantığı</Text>
              <View style={styles.filterOptionsGrid}>
                {[
                  { id: 'AND', label: 'VE (Tüm etiketleri içermeli)' },
                  { id: 'OR', label: 'VEYA (Herhangi birini içermeli)' },
                ].map((item) => {
                  const isSel = tagMatchMode === item.id;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.filterChoicePill, isSel && styles.filterChoicePillActive]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setTagMatchMode(item.id as any);
                      }}
                    >
                      <Text style={[styles.filterChoiceText, isSel && styles.filterChoiceTextActive]}>
                        {item.label}
                      </Text>
                      {isSel && <Check size={12} color="#111216" style={{ marginLeft: 2 }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Sıfırla ve Uygula Butonları */}
              <View style={styles.modalActionButtons}>
                <TouchableOpacity
                  style={styles.modalResetBtn}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setSelectedSource('all');
                    setMediaTypeFilter('all');
                    setRatingFilter('all');
                    setSortBy('fav_date');
                    setTagMatchMode('AND');
                    setDisplayLimit(40);
                  }}
                >
                  <RotateCcw size={15} color={Colors.dark.textSecondary} />
                  <Text style={styles.modalResetBtnText}>Sıfırla</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalApplyBtn}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setShowFilterSheet(false);
                  }}
                >
                  <Text style={styles.modalApplyBtnText}>Uygula ({filteredFavorites.length} Sonuç)</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>


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
  clearHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: 'rgba(255, 77, 79, 0.12)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 79, 0.25)',
  },
  clearHeaderBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FF6B6B',
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
    paddingTop: 10,
    paddingBottom: 24,
  },
  gridContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  columnWrapper: {
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
    position: 'relative',
    zIndex: 20,
  },
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#181A22',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: '#292D3B',
  },
  filterToggleBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#181A22',
    borderWidth: 1,
    borderColor: '#292D3B',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterToggleBtnActive: {
    borderColor: GOLD_ACCENT,
    backgroundColor: 'rgba(245, 166, 35, 0.12)',
  },
  filterActiveDot: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: GOLD_ACCENT,
  },
  searchBarFocused: {
    borderColor: GOLD_ACCENT,
    backgroundColor: '#1C1F2A',
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
  suggestionsDropdown: {
    position: 'absolute',
    top: 54,
    left: 16,
    right: 16,
    backgroundColor: '#161922',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#292D3B',
    maxHeight: 240,
    zIndex: 99,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    overflow: 'hidden',
  },
  suggestionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  suggestionsHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.dark.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  suggestionsScroll: {
    maxHeight: 195,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
  },
  suggestionLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 10,
  },
  suggestionText: {
    fontSize: 13,
    fontWeight: '600',
  },
  suggestionBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  suggestionBadgeText: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    fontWeight: '500',
  },
  selectedTagsContainer: {
    paddingVertical: 6,
  },
  selectedTagsContent: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectedTagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 166, 35, 0.15)',
    borderColor: 'rgba(245, 166, 35, 0.45)',
    borderWidth: 1,
    borderRadius: 10,
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 4,
    gap: 5,
  },
  selectedTagIcon: {
    marginRight: 1,
  },
  selectedTagText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    maxWidth: 160,
  },
  selectedTagRemoveBtn: {
    padding: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
  },
  clearAllTagsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 77, 79, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 79, 0.25)',
  },
  clearAllTagsText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FF6B6B',
  },
  modeToggleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  modeToggleLabel: {
    fontSize: 11,
    color: Colors.dark.textSecondary,
    fontWeight: '500',
  },
  modeToggleValue: {
    fontSize: 11,
    fontWeight: '700',
    color: GOLD_ACCENT,
  },
  sourcesContainer: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
  },
  sourcesContent: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sourcePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  sourcePillActive: {
    backgroundColor: GOLD_ACCENT,
    borderColor: GOLD_ACCENT,
  },
  sourcePillText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  sourcePillTextActive: {
    color: '#111216',
    fontWeight: '700',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#161922',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: '#292D3B',
    maxHeight: '80%',
    paddingBottom: 0,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.07)',
  },
  modalHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  modalScroll: {
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  filterSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.dark.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 8,
  },
  filterOptionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChoicePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterChoicePillActive: {
    backgroundColor: GOLD_ACCENT,
    borderColor: GOLD_ACCENT,
  },
  filterChoiceText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  filterChoiceTextActive: {
    color: '#111216',
    fontWeight: '700',
  },
  modalActionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 24,
    marginBottom: 10,
  },
  modalResetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  modalResetBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.dark.textSecondary,
  },
  modalApplyBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: GOLD_ACCENT,
  },
  modalApplyBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111216',
  },
});
