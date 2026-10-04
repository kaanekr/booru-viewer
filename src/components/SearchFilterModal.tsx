import React, { useState, useEffect } from 'react';
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Dimensions,
  TouchableWithoutFeedback,
  FlatList,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  X,
  Search,
  ChevronRight,
  Check,
  ShieldCheck,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import {
  BooruSource,
  BooruTagSuggestion,
  RatingFilterOption,
  SearchFilterConfig,
  SortOption,
  TimeRangeOption,
  CumstServiceOption,
  CumstMediaTypeOption,
  DEFAULT_FILTER_CONFIG,
} from '../types/booru';
import { booruApi } from '../services/booruApi';
import { nhentaiTagQuery } from '../services/nhentai';
import { dayDateOptions, weekDateOptions, monthDateOptions, describeAnchor } from '../utils/leaderboardPeriods';
import { AVAILABLE_SOURCES } from '../services/sources';
import { useSource } from '../context/SourceContext';
import { TagChip } from './TagChip';
import { Colors } from '../theme/colors';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const GOLD_ACCENT = '#F5A623';

const SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Varsayılan Sıralama' },
  { label: 'Id', value: 'id', desc: 'En Yeniler / Gönderi No' },
  { label: 'Score', value: 'score', desc: 'Popülerlik / En Yüksek Puan' },
  { label: 'Rating', value: 'rating', desc: 'Derecelendirmeye Göre' },
  { label: 'User', value: 'user', desc: 'Kullanıcı / Sanatçıya Göre' },
  { label: 'Height', value: 'height', desc: 'Yüksekliğe Göre' },
  { label: 'Width', value: 'width', desc: 'Genişliğe Göre' },
];

const REDGIFS_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Varsayılan (Trendler)' },
  { label: 'Trendler (Trending)', value: 'score', desc: 'En Popüler / Trend Klipler' },
  { label: 'En Yeniler (Latest)', value: 'id', desc: 'Son Eklenen Videolar' },
];

const XVIDEOS_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Varsayılan (Alaka Düzeyi)' },
  { label: 'En Yeniler', value: 'id', desc: 'Yüklenme Tarihine Göre' },
  { label: 'İzlenme', value: 'score', desc: 'En Çok İzlenenler' },
  { label: 'Oy Oranı', value: 'rating', desc: 'En Beğenilenler' },
  { label: 'Süre', value: 'height', desc: 'Video Süresine Göre' },
];

const XHAMSTER_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Varsayılan (En Yeniler)' },
  { label: 'En Yeniler', value: 'id', desc: 'Yüklenme Tarihine Göre' },
  { label: 'İzlenme', value: 'score', desc: 'En Çok İzlenenler' },
  { label: 'En İyiler', value: 'rating', desc: 'En Beğenilenler' },
  { label: 'Süre', value: 'height', desc: 'Video Süresine Göre' },
];

const PORNHUB_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Varsayılan (En Yeniler)' },
  { label: 'En Yeniler', value: 'id', desc: 'Yüklenme Tarihine Göre' },
  { label: 'İzlenme', value: 'score', desc: 'En Çok İzlenenler' },
  { label: 'Oy Oranı', value: 'rating', desc: 'En Beğenilenler' },
];

const SEXCOM_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Varsayılan (Öne Çıkanlar)' },
];

const HENTAIHAVEN_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Varsayılan (Trend)' },
];

const NHENTAI_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Varsayılan (En Yeniler)' },
  { label: 'En Yeniler', value: 'id', desc: 'Son Eklenen Mangalar' },
  { label: 'Popüler', value: 'score', desc: 'En Çok Favorilenenler' },
];

const CUMST_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: 'Score (Popülerlik)', value: 'score', desc: 'En Çok Kaydedilenler / Liderlik' },
  { label: 'Id (En Yeniler)', value: 'id', desc: 'Son Eklenen Gönderiler' },
  { label: 'Videolar', value: 'width', desc: 'Videolu Gönderiler' },
  { label: 'Çoklu Medya', value: 'height', desc: 'Çoklu Medya Ekleri' },
];

const TIME_RANGES: { label: string; value: TimeRangeOption }[] = [
  { label: 'Tüm Zamanlar', value: 'all' },
  { label: 'Son 24 Saat / Günün Lideri', value: '1d' },
  { label: 'Bu Hafta / Haftanın Lideri', value: '1w' },
  { label: 'Bu Ay / Ayın Lideri', value: '1m' },
  { label: 'Bu Yıl', value: '1y' },
];

const CUMST_SERVICE_OPTIONS: { label: string; value: CumstServiceOption; desc: string }[] = [
  { label: 'Hepsi', value: 'all', desc: 'Tüm Platformlar (OnlyFans & Fansly)' },
  { label: 'OnlyFans', value: 'onlyfans', desc: 'Sadece OnlyFans içerikleri' },
  { label: 'Fansly', value: 'fansly', desc: 'Sadece Fansly içerikleri' },
];

const CUMST_MEDIA_OPTIONS: { label: string; value: CumstMediaTypeOption; desc: string }[] = [
  { label: 'Hepsi', value: 'all', desc: 'Tüm medya türleri' },
  { label: 'Sadece Videolar', value: 'videos', desc: 'Video klipler ve kayıtlar' },
  { label: 'Sadece Fotoğraflar', value: 'photos', desc: 'Görseller ve galeriler' },
  { label: 'Ses / Audio', value: 'audio', desc: 'Ses kayıtları' },
];

const RATING_OPTIONS: { label: string; value: RatingFilterOption }[] = [
  { label: 'Hepsi', value: 'all' },
  { label: 'Safe (Güvenli)', value: 'safe' },
  { label: 'Questionable', value: 'questionable' },
  { label: 'Explicit (18+)', value: 'explicit' },
];

const MIN_SCORE_OPTIONS: { label: string; value: number | undefined }[] = [
  { label: 'Fark Etmez', value: undefined },
  { label: '10+ Puan', value: 10 },
  { label: '50+ Puan', value: 50 },
  { label: '100+ Puan', value: 100 },
  { label: '500+ Puan', value: 500 },
];

/** nhentai'de skor = favori sayısı; ölçek daha yüksek (binler). */
const NHENTAI_MIN_SCORE_OPTIONS: { label: string; value: number | undefined }[] = [
  { label: 'Fark Etmez', value: undefined },
  { label: '100+ Favori', value: 100 },
  { label: '500+ Favori', value: 500 },
  { label: '1.000+ Favori', value: 1000 },
  { label: '5.000+ Favori', value: 5000 },
  { label: '10.000+ Favori', value: 10000 },
];

interface SearchFilterModalProps {
  visible: boolean;
  filterConfig: SearchFilterConfig;
  activeSource: BooruSource;
  onClose: () => void;
  onApply: (config: SearchFilterConfig) => void;
}

export const SearchFilterModal: React.FC<SearchFilterModalProps> = ({
  visible,
  filterConfig,
  activeSource: propSource,
  onClose,
  onApply,
}) => {
  const insets = useSafeAreaInsets();
  const { activeSource: contextSource, selectSource } = useSource();
  const activeSource = contextSource ?? propSource;
  const [draft, setDraft] = useState<SearchFilterConfig>(filterConfig);
  const [tagInput, setTagInput] = useState('');
  const [suggestions, setSuggestions] = useState<BooruTagSuggestion[]>([]);

  // Popover menus state
  const [showSortPicker, setShowSortPicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showRatingPicker, setShowRatingPicker] = useState(false);
  const [showScorePicker, setShowScorePicker] = useState(false);
  const [showPagePicker, setShowPagePicker] = useState(false);
  const [showCumstServicePicker, setShowCumstServicePicker] = useState(false);
  const [showCumstMediaPicker, setShowCumstMediaPicker] = useState(false);
  const [showDateAnchorPicker, setShowDateAnchorPicker] = useState(false);
  const [isSourceListOpen, setIsSourceListOpen] = useState(false);
  const [customDateText, setCustomDateText] = useState('');
  const [pageInputText, setPageInputText] = useState('');

  // Sync draft when modal opens
  useEffect(() => {
    if (visible) {
      setDraft({ ...filterConfig });
      setTagInput('');
      setSuggestions([]);
      setIsSourceListOpen(false);
      setPageInputText(filterConfig.jumpToPage > 1 ? String(filterConfig.jumpToPage) : '');
    }
  }, [visible, filterConfig]);

  // Autocomplete from server for filter modal tag input
  useEffect(() => {
    if (!draft.autocompleteFromServer || !tagInput) {
      setSuggestions([]);
      return;
    }

    if (tagInput.endsWith(' ')) {
      setSuggestions([]);
      return;
    }

    const tokens = tagInput.trim().split(/[\s,]+/);
    const activeToken = tokens[tokens.length - 1] || '';
    const cleanToken = activeToken.replace(/^-+/, '').trim();

    if (cleanToken.length < 2) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      const list = await booruApi.searchTags(cleanToken);
      setSuggestions(list);
    }, 200);

    return () => clearTimeout(timer);
  }, [tagInput, draft.autocompleteFromServer]);

  const handleAddTag = (tagToAdd: string) => {
    // Boşluk veya virgülle ayrılmış birden fazla etiketi tek tek ayrıştır;
    // tırnaklı grup tek parça kalır (tag:"big breasts" bölünmez)
    const parts = tagToAdd.trim().match(/("[^"]*"|[^\s,"])+/g) || [];
    const validTags = parts
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 0 && !draft.tags.includes(p));

    if (validTags.length > 0) {
      Haptics.selectionAsync();
      setDraft((prev) => ({
        ...prev,
        tags: [...prev.tags, ...validTags],
      }));
    }
    setTagInput('');
    setSuggestions([]);
  };

  const handleSelectSuggestion = (suggestedTag: string, category?: BooruTagSuggestion['category']) => {
    Haptics.selectionAsync();
    // nhentai: öneri `tag:"ad"` mekaniğiyle eklenir
    const qualified =
      activeSource.type === 'nhentai' ? nhentaiTagQuery(suggestedTag, category) : suggestedTag.trim().toLowerCase();
    // Varsa önceki yazılmış token'ları da al, son yazılanı öneri ile tamamla
    const tokens = tagInput.trim().match(/("[^"]*"|[^\s,"])+/g) || [];
    const previousTokens = tokens.slice(0, -1).map((t) => t.trim().toLowerCase()).filter(Boolean);

    const toAdd = [...previousTokens, qualified].filter((t) => !draft.tags.includes(t));
    if (toAdd.length > 0) {
      setDraft((prev) => ({
        ...prev,
        tags: [...prev.tags, ...toAdd],
      }));
    }
    setTagInput('');
    setSuggestions([]);
  };

  const handleRemoveTag = (tagToRemove: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDraft((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tagToRemove),
    }));
  };

  const handleReset = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDraft({
      ...DEFAULT_FILTER_CONFIG,
      autocompleteFromServer: draft.autocompleteFromServer,
    });
    setTagInput('');
    setPageInputText('');
    setSuggestions([]);
  };

  const confirmPageInput = () => {
    const rawDigits = pageInputText.replace(/[^0-9]/g, '');
    const n = parseInt(rawDigits, 10);
    Haptics.selectionAsync();
    const resolvedPage = Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : 1;
    setDraft((prev) => ({ ...prev, jumpToPage: resolvedPage }));
    setPageInputText(resolvedPage > 1 ? String(resolvedPage) : '');
    setShowPagePicker(false);
  };

  const handleApplySearch = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    let finalDraft = { ...draft };
    if (tagInput.trim()) {
      const extraTags = (tagInput.trim().match(/("[^"]*"|[^\s,"])+/g) || [])
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      for (const extraTag of extraTags) {
        if (!finalDraft.tags.includes(extraTag)) {
          finalDraft.tags = [...finalDraft.tags, extraTag];
        }
      }
    }
    // Emniyet: Kullanıcı sayfaya git popup'ında sayı yazıp doğrudan Uygula'ya basarsa
    if (pageInputText.trim()) {
      const n = parseInt(pageInputText.replace(/[^0-9]/g, ''), 10);
      if (Number.isFinite(n) && n > 0) {
        finalDraft.jumpToPage = Math.min(n, 9999);
      }
    }
    onApply(finalDraft);
  };

  const getSortLabel = () => {
    if (activeSource.type === 'redgifs') {
      const opt = REDGIFS_SORT_OPTIONS.find((s) => s.value === draft.sortBy);
      return opt ? opt.label : '---';
    }
    if (activeSource.type === 'xvideos') {
      const opt = XVIDEOS_SORT_OPTIONS.find((s) => s.value === draft.sortBy);
      return opt ? opt.label : '---';
    }
    if (activeSource.type === 'xhamster') {
      const opt = XHAMSTER_SORT_OPTIONS.find((s) => s.value === draft.sortBy);
      return opt ? opt.label : '---';
    }
    if (activeSource.type === 'pornhub') {
      const opt = PORNHUB_SORT_OPTIONS.find((s) => s.value === draft.sortBy);
      return opt ? opt.label : '---';
    }
    if (activeSource.type === 'sexcom') {
      const opt = SEXCOM_SORT_OPTIONS.find((s) => s.value === draft.sortBy);
      return opt ? opt.label : '---';
    }
    if (activeSource.type === 'hentaihaven') {
      const opt = HENTAIHAVEN_SORT_OPTIONS.find((s) => s.value === draft.sortBy);
      return opt ? opt.label : '---';
    }
    if (activeSource.type === 'nhentai') {
      const opt = NHENTAI_SORT_OPTIONS.find((s) => s.value === draft.sortBy);
      return opt ? opt.label : '---';
    }
    if (activeSource.type === 'cumst') {
      const opt = CUMST_SORT_OPTIONS.find((s) => s.value === draft.sortBy);
      return opt ? opt.label : '---';
    }
    const opt = SORT_OPTIONS.find((s) => s.value === draft.sortBy);
    return opt ? opt.label : '---';
  };

  const getTimeLabel = () => {
    const opt = TIME_RANGES.find((t) => t.value === draft.timeRange);
    return opt ? opt.label : 'Tüm Zamanlar';
  };

  const getRatingLabel = () => {
    const opt = RATING_OPTIONS.find((r) => r.value === draft.rating);
    return opt ? opt.label : 'Hepsi';
  };

  const getScoreLabel = () => {
    if (!draft.minScore) return '---';
    return `${draft.minScore}+`;
  };

  const getCumstServiceLabel = () => {
    const opt = CUMST_SERVICE_OPTIONS.find((s) => s.value === draft.cumstService);
    return opt ? opt.label : 'Hepsi';
  };

  const getCumstMediaLabel = () => {
    const opt = CUMST_MEDIA_OPTIONS.find((m) => m.value === draft.cumstMediaType);
    return opt ? opt.label : 'Hepsi';
  };

  const getDateLabel = () => describeAnchor(draft.leaderboardDate, draft.timeRange);

  // Tarih seçici, aktif zaman dilimine göre periyoda uygun slot sunar:
  // haftalık modda haftalar, aylık modda aylar, diğerlerinde günler.
  const dateSlots =
    draft.timeRange === '1w'
      ? weekDateOptions()
      : draft.timeRange === '1m'
        ? monthDateOptions()
        : dayDateOptions();
  const datePickerTitle =
    draft.timeRange === '1w'
      ? 'Hafta Seçimi'
      : draft.timeRange === '1m'
        ? 'Ay Seçimi'
        : 'Geçmiş Tarih Seçimi';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
      onRequestClose={onClose}
      onDismiss={onClose}
    >
      <View
        style={[
          styles.container,
          {
            paddingTop: Platform.OS === 'ios' ? 8 : insets.top,
          },
        ]}
      >
        {/* Drag Handle Indicator */}
        <View style={styles.dragHandleContainer}>
          <View style={styles.dragHandle} />
        </View>

        {/* Header (Screenshot 1: X on left, Filter in center, Search icon on right) */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.circleBtn}
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X size={20} color="#FFFFFF" />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Filter</Text>

          <TouchableOpacity
            style={[styles.circleBtn, styles.searchBtn]}
            onPress={handleApplySearch}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Search size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + 40 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={true}
        >
          {/* Tag Chips & Input Box */}
          <View style={styles.searchBox}>
            <Search size={18} color={Colors.dark.textMuted} style={styles.searchIcon} />

            <View style={styles.chipsAndInputContainer}>
              {draft.tags.map((tag, idx) => (
                <View key={`draft-tag-${tag}-${idx}`} style={styles.tagChip}>
                  <Text style={styles.tagChipText}>{tag}</Text>
                  <TouchableOpacity
                    onPress={() => handleRemoveTag(tag)}
                    style={styles.tagChipRemove}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text style={styles.tagChipX}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <TextInput
                style={styles.textInput}
                placeholder={draft.tags.length === 0 ? 'Etiket ekle (örn: 1girl)...' : 'Daha fazla ekle...'}
                placeholderTextColor={Colors.dark.textMuted}
                value={tagInput}
                onChangeText={setTagInput}
                onSubmitEditing={() => handleAddTag(tagInput)}
                returnKeyType="done"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          {/* Autocomplete dropdown overlay */}
          {suggestions.length > 0 && (
            <View style={styles.suggestionsCard}>
              <FlatList
                data={suggestions}
                keyExtractor={(item, index) => `suggest-${item.name}-${index}`}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                style={{ maxHeight: 200 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.suggestionRow}
                    onPress={() => handleSelectSuggestion(item.name, item.category)}
                  >
                    <TagChip
                      name={item.name}
                      category={item.category}
                      count={item.postCount}
                      size="sm"
                      onPress={() => handleSelectSuggestion(item.name, item.category)}
                    />
                  </TouchableOpacity>
                )}
              />
            </View>
          )}

          {/* Server Section */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionHeader}>Server</Text>
            <View style={styles.cardGroup}>
              <TouchableOpacity
                style={styles.rowItem}
                onPress={() => {
                  Haptics.selectionAsync();
                  setIsSourceListOpen((v) => !v);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.sourceInfo}>
                  <Text style={styles.rowLabel}>Kaynak: {activeSource.name}</Text>
                  <Text style={styles.serverUrlText} numberOfLines={1}>
                    {activeSource.baseUrl}
                  </Text>
                </View>
                <View style={styles.rowRight}>
                  <ChevronRight size={18} color={Colors.dark.textMuted} />
                </View>
              </TouchableOpacity>

              {isSourceListOpen && (
                <>
                  <View style={styles.rowDivider} />
                  {AVAILABLE_SOURCES.map((source, index) => {
                    const isSelected = activeSource.id === source.id;
                    return (
                      <React.Fragment key={source.id}>
                        <TouchableOpacity
                          style={[
                            styles.sourceRow,
                            isSelected && styles.sourceRowSelected,
                          ]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            selectSource(source);
                          }}
                          activeOpacity={0.7}
                        >
                          <View style={styles.sourceInfo}>
                            <View style={styles.sourceNameRow}>
                              <Text style={styles.sourceName}>{source.name}</Text>
                              {source.isSafeOnly && (
                                <View style={styles.safeBadge}>
                                  <ShieldCheck size={12} color={Colors.dark.safe} />
                                  <Text style={styles.safeBadgeText}>SFW</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.sourceDesc} numberOfLines={1}>
                              {source.description}
                            </Text>
                          </View>

                          {isSelected && (
                            <View style={styles.checkCircle}>
                              <Check size={14} color="#FFFFFF" />
                            </View>
                          )}
                        </TouchableOpacity>
                        {index !== AVAILABLE_SOURCES.length - 1 && <View style={styles.rowDivider} />}
                      </React.Fragment>
                    );
                  })}
                </>
              )}
            </View>
          </View>

          {/* Options Section */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionHeader}>Options</Text>
            <View style={styles.cardGroup}>
              {/* Jump to Page */}
              <TouchableOpacity
                style={styles.rowItem}
                onPress={() => {
                  setPageInputText(draft.jumpToPage > 1 ? String(draft.jumpToPage) : '');
                  setShowPagePicker(true);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.rowLabel}>Jump to Page</Text>
                <View style={styles.rowRight}>
                  <Text style={styles.rowValue}>
                    {draft.jumpToPage > 1 ? `Sayfa ${draft.jumpToPage}` : '---'}
                  </Text>
                  <ChevronRight size={18} color={Colors.dark.textMuted} />
                </View>
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Include Blacklisted */}
              <TouchableOpacity
                style={styles.rowItem}
                onPress={() => {
                  Haptics.selectionAsync();
                  setDraft((prev) => ({ ...prev, includeBlacklisted: !prev.includeBlacklisted }));
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.rowLabel}>Include Blacklisted</Text>
                <View style={styles.rowRight}>
                  {draft.includeBlacklisted && <Check size={18} color={GOLD_ACCENT} />}
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* Server Options Section */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionHeader}>Server options</Text>
            <View style={styles.cardGroup}>
              {/* Sort by */}
              <TouchableOpacity
                style={styles.rowItem}
                onPress={() => setShowSortPicker(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.rowLabel}>Sort by</Text>
                <View style={styles.rowRight}>
                  <Text style={styles.rowValue}>{getSortLabel()}</Text>
                  <ChevronRight size={18} color={Colors.dark.textMuted} />
                </View>
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Popularity Time Range / Leaderboard (Zaman Dilimi) */}
              <TouchableOpacity
                style={styles.rowItem}
                onPress={() => setShowTimePicker(true)}
                activeOpacity={0.7}
              >
                <Text style={styles.rowLabel}>
                  {activeSource.type === 'cumst' ? 'Zaman Dilimi (Liderlik Tablosu)' : 'Zaman Dilimi (Popülerlik)'}
                </Text>
                <View style={styles.rowRight}>
                  <Text style={[styles.rowValue, draft.timeRange !== 'all' && { color: GOLD_ACCENT }]}>
                    {getTimeLabel()}
                  </Text>
                  <ChevronRight size={18} color={Colors.dark.textMuted} />
                </View>
              </TouchableOpacity>

              {activeSource.type === 'cumst' ? (
                <>
                  <View style={styles.rowDivider} />

                  {/* Platform / Servis Filter */}
                  <TouchableOpacity
                    style={styles.rowItem}
                    onPress={() => setShowCumstServicePicker(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.rowLabel}>Platform / Servis</Text>
                    <View style={styles.rowRight}>
                      <Text style={[styles.rowValue, draft.cumstService !== 'all' && { color: GOLD_ACCENT }]}>
                        {getCumstServiceLabel()}
                      </Text>
                      <ChevronRight size={18} color={Colors.dark.textMuted} />
                    </View>
                  </TouchableOpacity>

                  <View style={styles.rowDivider} />

                  {/* Media Type Filter */}
                  <TouchableOpacity
                    style={styles.rowItem}
                    onPress={() => setShowCumstMediaPicker(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.rowLabel}>Medya Türü</Text>
                    <View style={styles.rowRight}>
                      <Text style={[styles.rowValue, draft.cumstMediaType !== 'all' && { color: GOLD_ACCENT }]}>
                        {getCumstMediaLabel()}
                      </Text>
                      <ChevronRight size={18} color={Colors.dark.textMuted} />
                    </View>
                  </TouchableOpacity>

                  <View style={styles.rowDivider} />

                  {/* Historical Date Anchor (Geçmiş Liderlik Tarihi) */}
                  <TouchableOpacity
                    style={styles.rowItem}
                    onPress={() => {
                      setCustomDateText(draft.leaderboardDate || '');
                      setShowDateAnchorPicker(true);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.rowLabel}>Geçmiş Liderlik Tarihi (Arşiv)</Text>
                    <View style={styles.rowRight}>
                      <Text style={[styles.rowValue, !!draft.leaderboardDate && { color: GOLD_ACCENT }]}>
                        {getDateLabel()}
                      </Text>
                      <ChevronRight size={18} color={Colors.dark.textMuted} />
                    </View>
                  </TouchableOpacity>
                </>
              ) : activeSource.type === 'redgifs' || activeSource.type === 'xvideos' || activeSource.type === 'xhamster' || activeSource.type === 'pornhub' || activeSource.type === 'sexcom' || activeSource.type === 'hentaihaven' ? null : (
                <>
                  {/* Rating: nhentai'de tüm içerik 'e' (Explicit) olduğu için anlamsız */}
                  {activeSource.type !== 'nhentai' ? (
                    <>
                      <View style={styles.rowDivider} />

                      {/* Rating Filter */}
                      <TouchableOpacity
                        style={styles.rowItem}
                        onPress={() => setShowRatingPicker(true)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.rowLabel}>Derecelendirme</Text>
                        <View style={styles.rowRight}>
                          <Text style={[styles.rowValue, draft.rating !== 'all' && { color: GOLD_ACCENT }]}>
                            {getRatingLabel()}
                          </Text>
                          <ChevronRight size={18} color={Colors.dark.textMuted} />
                        </View>
                      </TouchableOpacity>
                    </>
                  ) : null}

                  <View style={styles.rowDivider} />

                  {/* Min Score (nhentai'de = favori sayısı) */}
                  <TouchableOpacity
                    style={styles.rowItem}
                    onPress={() => setShowScorePicker(true)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.rowLabel}>
                      {activeSource.type === 'nhentai' ? 'Min Favori (Puan)' : 'Min Puan (Score)'}
                    </Text>
                    <View style={styles.rowRight}>
                      <Text style={[styles.rowValue, draft.minScore ? { color: GOLD_ACCENT } : {}]}>
                        {getScoreLabel()}
                      </Text>
                      <ChevronRight size={18} color={Colors.dark.textMuted} />
                    </View>
                  </TouchableOpacity>
                </>
              )}

              <View style={styles.rowDivider} />

              {/* Autocomplete from Server */}
              <TouchableOpacity
                style={styles.rowItem}
                onPress={() => {
                  Haptics.selectionAsync();
                  setDraft((prev) => ({
                    ...prev,
                    autocompleteFromServer: !prev.autocompleteFromServer,
                  }));
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.rowLabel}>Autocomplete from Server</Text>
                <View style={styles.rowRight}>
                  {draft.autocompleteFromServer && <Check size={18} color={GOLD_ACCENT} />}
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* Reset Action */}
          <TouchableOpacity
            style={styles.resetCard}
            onPress={handleReset}
            activeOpacity={0.7}
          >
            <Text style={styles.resetText}>Reset</Text>
            <ChevronRight size={18} color={GOLD_ACCENT} />
          </TouchableOpacity>
        </ScrollView>

        {/* -------------------- FLOATING POPUPS -------------------- */}

        {/* 1. Sort by Popup */}
        <Modal
          visible={showSortPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowSortPicker(false)}
        >
          <TouchableWithoutFeedback onPress={() => setShowSortPicker(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.popoverCard}>
                  <Text style={styles.popoverTitle}>Sort by</Text>
                  <View style={styles.popoverList}>
                    {(activeSource.type === 'redgifs'
                      ? REDGIFS_SORT_OPTIONS
                      : activeSource.type === 'xvideos'
                      ? XVIDEOS_SORT_OPTIONS
                      : activeSource.type === 'xhamster'
                      ? XHAMSTER_SORT_OPTIONS
                      : activeSource.type === 'pornhub'
                      ? PORNHUB_SORT_OPTIONS
                      : activeSource.type === 'sexcom'
                      ? SEXCOM_SORT_OPTIONS
                      : activeSource.type === 'hentaihaven'
                      ? HENTAIHAVEN_SORT_OPTIONS
                      : activeSource.type === 'nhentai'
                      ? NHENTAI_SORT_OPTIONS
                      : activeSource.type === 'cumst'
                      ? CUMST_SORT_OPTIONS
                      : SORT_OPTIONS
                    ).map((opt) => {
                      const isSelected = draft.sortBy === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          style={[styles.popoverItem, isSelected && styles.popoverItemSelected]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setDraft((prev) => ({ ...prev, sortBy: opt.value }));
                            setShowSortPicker(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.popoverItemText,
                              isSelected && styles.popoverItemTextSelected,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* 2. Time Range (Zaman Dilimi) Popup */}
        <Modal
          visible={showTimePicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowTimePicker(false)}
        >
          <TouchableWithoutFeedback onPress={() => setShowTimePicker(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.popoverCard}>
                  <Text style={styles.popoverTitle}>Zaman Dilimi</Text>
                  <View style={styles.popoverList}>
                    {TIME_RANGES.map((opt) => {
                      const isSelected = draft.timeRange === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          style={[styles.popoverItem, isSelected && styles.popoverItemSelected]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setDraft((prev) => ({
                              ...prev,
                              timeRange: opt.value,
                              sortBy: prev.sortBy === 'default' ? 'score' : prev.sortBy,
                            }));
                            setShowTimePicker(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.popoverItemText,
                              isSelected && styles.popoverItemTextSelected,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* 3. Rating Filter Popup */}
        <Modal
          visible={showRatingPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowRatingPicker(false)}
        >
          <TouchableWithoutFeedback onPress={() => setShowRatingPicker(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.popoverCard}>
                  <Text style={styles.popoverTitle}>Derecelendirme</Text>
                  <View style={styles.popoverList}>
                    {RATING_OPTIONS.map((opt) => {
                      const isSelected = draft.rating === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          style={[styles.popoverItem, isSelected && styles.popoverItemSelected]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setDraft((prev) => ({ ...prev, rating: opt.value }));
                            setShowRatingPicker(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.popoverItemText,
                              isSelected && styles.popoverItemTextSelected,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* 4. Min Score Popup */}
        <Modal
          visible={showScorePicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowScorePicker(false)}
        >
          <TouchableWithoutFeedback onPress={() => setShowScorePicker(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.popoverCard}>
                  <Text style={styles.popoverTitle}>
                    {activeSource.type === 'nhentai'
                      ? 'Minimum Favori Sayısı'
                      : 'Minimum Puan (Score)'}
                  </Text>
                  <View style={styles.popoverList}>
                    {(activeSource.type === 'nhentai'
                      ? NHENTAI_MIN_SCORE_OPTIONS
                      : MIN_SCORE_OPTIONS
                    ).map((opt, i) => {
                      const isSelected = draft.minScore === opt.value;
                      return (
                        <TouchableOpacity
                          key={i}
                          style={[styles.popoverItem, isSelected && styles.popoverItemSelected]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setDraft((prev) => ({ ...prev, minScore: opt.value }));
                            setShowScorePicker(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.popoverItemText,
                              isSelected && styles.popoverItemTextSelected,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* 5. Jump to Page Popup */}
        <Modal
          visible={showPagePicker}
          transparent
          animationType="fade"
          onRequestClose={confirmPageInput}
        >
          <TouchableWithoutFeedback onPress={confirmPageInput}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.popoverCard}>
                  <Text style={styles.popoverTitle}>Sayfaya Git</Text>
                  <TextInput
                    style={styles.pageInput}
                    placeholder={`Sayfa numarası (şu an: ${draft.jumpToPage})`}
                    placeholderTextColor={Colors.dark.textMuted}
                    value={pageInputText}
                    onChangeText={setPageInputText}
                    keyboardType="number-pad"
                    returnKeyType="done"
                    autoCapitalize="none"
                    autoCorrect={false}
                    selectTextOnFocus
                    onSubmitEditing={confirmPageInput}
                  />
                  <View style={styles.pageBtnRow}>
                    <TouchableOpacity
                      style={[styles.popoverItem, styles.pageConfirmBtn]}
                      onPress={confirmPageInput}
                    >
                      <Text style={[styles.popoverItemText, styles.popoverItemTextSelected]}>Git</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.popoverItem}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setDraft((prev) => ({ ...prev, jumpToPage: 1 }));
                        setPageInputText('');
                        setShowPagePicker(false);
                      }}
                    >
                      <Text style={styles.popoverItemText}>Sıfırla (1)</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
        {/* 6. Cum.st Platform / Service Popup */}
        <Modal
          visible={showCumstServicePicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCumstServicePicker(false)}
        >
          <TouchableWithoutFeedback onPress={() => setShowCumstServicePicker(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.popoverCard}>
                  <Text style={styles.popoverTitle}>Platform / Servis</Text>
                  <View style={styles.popoverList}>
                    {CUMST_SERVICE_OPTIONS.map((opt) => {
                      const isSelected = draft.cumstService === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          style={[styles.popoverItem, isSelected && styles.popoverItemSelected]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setDraft((prev) => ({ ...prev, cumstService: opt.value }));
                            setShowCumstServicePicker(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.popoverItemText,
                              isSelected && styles.popoverItemTextSelected,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* 7. Cum.st Media Type Popup */}
        <Modal
          visible={showCumstMediaPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCumstMediaPicker(false)}
        >
          <TouchableWithoutFeedback onPress={() => setShowCumstMediaPicker(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={styles.popoverCard}>
                  <Text style={styles.popoverTitle}>Medya Türü</Text>
                  <View style={styles.popoverList}>
                    {CUMST_MEDIA_OPTIONS.map((opt) => {
                      const isSelected = draft.cumstMediaType === opt.value;
                      return (
                        <TouchableOpacity
                          key={opt.value}
                          style={[styles.popoverItem, isSelected && styles.popoverItemSelected]}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setDraft((prev) => ({ ...prev, cumstMediaType: opt.value }));
                            setShowCumstMediaPicker(false);
                          }}
                        >
                          <Text
                            style={[
                              styles.popoverItemText,
                              isSelected && styles.popoverItemTextSelected,
                            ]}
                          >
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* 8. Cum.st Historical Date Anchor Popup */}
        <Modal
          visible={showDateAnchorPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowDateAnchorPicker(false)}
        >
          <TouchableWithoutFeedback onPress={() => setShowDateAnchorPicker(false)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.popoverCard, { maxHeight: '80%' }]}>
                  <Text style={styles.popoverTitle}>{datePickerTitle}</Text>
                  <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={true}>
                    <View style={styles.popoverList}>
                      {dateSlots.map((opt, idx) => {
                        const isSelected = draft.leaderboardDate === opt.value;
                        return (
                          <TouchableOpacity
                            key={idx}
                            style={[styles.popoverItem, isSelected && styles.popoverItemSelected]}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setDraft((prev) => ({
                                ...prev,
                                leaderboardDate: opt.value,
                                sortBy: opt.value ? 'score' : prev.sortBy,
                                // Tarih seçimi periyodun zamanını da seçer:
                                // haftalık slot haftalık liderliği, aylık slot
                                // aylık liderliği açar. Temizlemede aynen kalır.
                                timeRange: opt.value ? opt.range : prev.timeRange,
                              }));
                              setShowDateAnchorPicker(false);
                            }}
                          >
                            <Text
                              style={[
                                styles.popoverItemText,
                                isSelected && styles.popoverItemTextSelected,
                              ]}
                            >
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </ScrollView>

                  {/* Custom Date Input Row */}
                  <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 10 }}>
                    <Text style={{ fontSize: 12, color: '#8E92A4', marginBottom: 6 }}>Özel Tarih (YYYY-AA-GG):</Text>
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <TextInput
                        style={{
                          flex: 1,
                          backgroundColor: '#1E2026',
                          borderRadius: 8,
                          borderWidth: 1,
                          borderColor: '#2D313A',
                          color: '#FFFFFF',
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          fontSize: 13,
                        }}
                        placeholder="Örn: 2026-05-15"
                        placeholderTextColor="#7E8494"
                        value={customDateText}
                        onChangeText={setCustomDateText}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <TouchableOpacity
                        style={{
                          backgroundColor: GOLD_ACCENT,
                          borderRadius: 8,
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                        }}
                        onPress={() => {
                          const trimmed = customDateText.trim();
                          if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
                            Haptics.selectionAsync();
                            setDraft((prev) => ({
                              ...prev,
                              leaderboardDate: trimmed,
                              sortBy: 'score',
                            }));
                            setShowDateAnchorPicker(false);
                          }
                        }}
                      >
                        <Text style={{ color: '#111216', fontWeight: '700', fontSize: 13 }}>Uygula</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111216',
  },
  dragHandleContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 2,
  },
  dragHandle: {
    width: 38,
    height: 4.5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  circleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#262930',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBtn: {
    backgroundColor: '#262930',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  searchBox: {
    backgroundColor: '#1E2026',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2D313A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
  },
  searchIcon: {
    marginRight: 8,
  },
  chipsAndInputContainer: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2C303B',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 6,
  },
  tagChipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
  tagChipRemove: {
    paddingHorizontal: 2,
  },
  tagChipX: {
    color: GOLD_ACCENT,
    fontSize: 12,
    fontWeight: '700',
  },
  textInput: {
    flex: 1,
    minWidth: 120,
    color: '#FFFFFF',
    fontSize: 14,
    paddingVertical: 4,
  },
  suggestionsCard: {
    backgroundColor: '#1E2026',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2D313A',
    marginTop: 8,
    padding: 8,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 8,
  },
  suggestionRow: {
    paddingVertical: 4,
  },
  sectionContainer: {
    marginTop: 22,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E92A4',
    marginBottom: 8,
    marginLeft: 4,
  },
  card: {
    backgroundColor: '#1A1C22',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2E38',
    padding: 16,
  },
  serverInfoBox: {
    padding: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  activeSourceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  activeSourceLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8E92A4',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  activeSourceNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: GOLD_ACCENT,
  },
  serverUrlText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#CBD5E1',
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  sourceRowSelected: {
    backgroundColor: 'rgba(108, 99, 255, 0.08)',
  },
  sourceInfo: {
    flex: 1,
    marginRight: 12,
  },
  sourceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  sourceName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  safeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(81, 207, 102, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  safeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.dark.safe,
  },
  sourceDesc: {
    fontSize: 12,
    color: '#7E8494',
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.dark.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardGroup: {
    backgroundColor: '#1A1C22',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2E38',
    overflow: 'hidden',
  },
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  rowLabel: {
    fontSize: 15,
    color: '#E6EDF3',
    fontWeight: '500',
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rowValue: {
    fontSize: 14,
    color: '#8E92A4',
  },
  rowDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginLeft: 16,
  },
  resetCard: {
    backgroundColor: '#1A1C22',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A2E38',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 15,
    marginTop: 24,
  },
  resetText: {
    fontSize: 15,
    fontWeight: '700',
    color: GOLD_ACCENT,
  },

  /* Popover styles (Screenshot 2) */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  popoverCard: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: '#22252D',
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 12,
  },
  popoverTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: 12,
  },
  popoverList: {
    gap: 8,
  },
  popoverItem: {
    backgroundColor: '#30343E',
    borderRadius: 20,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popoverItemSelected: {
    backgroundColor: GOLD_ACCENT,
  },
  popoverItemText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#E6EDF3',
  },
  popoverItemTextSelected: {
    color: '#111216',
    fontWeight: '700',
  },
  pageInput: {
    backgroundColor: '#30343E',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#454B5A',
  },
  pageBtnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  pageConfirmBtn: {
    flex: 1,
    backgroundColor: GOLD_ACCENT,
  },
});
