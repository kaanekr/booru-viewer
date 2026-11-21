import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  X,
  Search,
  ChevronRight,
  Check,
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
import { hentaiHavenTagQuery } from '../services/hentaihavens';
import { dayDateOptions, weekDateOptions, monthDateOptions, describeAnchor } from '../utils/leaderboardPeriods';
import { SourceCatalog, SourceMark } from './SourceCatalog';
import { useSource } from '../context/SourceContext';
import { TagChip } from './TagChip';
import { Colors } from '../theme/colors';

const AnimatedView = Animated?.View ?? View;
const GOLD_ACCENT = '#F5A623';

type ActivePicker =
  | 'sort'
  | 'time'
  | 'rating'
  | 'score'
  | 'page'
  | 'cumstService'
  | 'cumstMedia'
  | 'dateAnchor'
  | null;

const SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Default Sorting' },
  { label: 'Id', value: 'id', desc: 'Newest / Post No' },
  { label: 'Score', value: 'score', desc: 'Popularity / Highest Score' },
  { label: 'Rating', value: 'rating', desc: 'By Rating' },
  { label: 'User', value: 'user', desc: 'By User / Artist' },
  { label: 'Height', value: 'height', desc: 'By Height' },
  { label: 'Width', value: 'width', desc: 'By Width' },
];

const REDGIFS_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Default (Trending)' },
  { label: 'Trending', value: 'score', desc: 'Most Popular / Trending Clips' },
  { label: 'Latest', value: 'id', desc: 'Recently Added Videos' },
];

const XVIDEOS_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Default (Relevance)' },
  { label: 'Newest', value: 'id', desc: 'By Upload Date' },
  { label: 'Views', value: 'score', desc: 'Most Viewed' },
  { label: 'Rating Ratio', value: 'rating', desc: 'Most Liked' },
  { label: 'Duration', value: 'height', desc: 'By Video Duration' },
];

const XHAMSTER_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Default (Newest)' },
  { label: 'Newest', value: 'id', desc: 'By Upload Date' },
  { label: 'Views', value: 'score', desc: 'Most Viewed' },
  { label: 'Top Rated', value: 'rating', desc: 'Most Liked' },
  { label: 'Duration', value: 'height', desc: 'By Video Duration' },
];

const PORNHUB_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Default (Newest)' },
  { label: 'Newest', value: 'id', desc: 'By Upload Date' },
  { label: 'Views', value: 'score', desc: 'Most Viewed' },
  { label: 'Rating Ratio', value: 'rating', desc: 'Most Liked' },
];

const SEXCOM_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Default (Featured)' },
];

const HENTAIHAVEN_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: 'Newest', value: 'default', desc: 'Recently added series (hentai/all)' },
  { label: 'Monthly Trends', value: 'score', desc: 'Most watched (home/trending)' },
];

const NHENTAI_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: '---', value: 'default', desc: 'Default (Newest)' },
  { label: 'Newest', value: 'id', desc: 'Recently Added Manga' },
  { label: 'Popular', value: 'score', desc: 'Most Favorited' },
];

const CUMST_SORT_OPTIONS: { label: string; value: SortOption; desc: string }[] = [
  { label: 'Score (Popularity)', value: 'score', desc: 'Most Saved / Leaderboard' },
  { label: 'Id (Newest)', value: 'id', desc: 'Recently Added Posts' },
  { label: 'Videos', value: 'width', desc: 'Posts with Video' },
  { label: 'Multiple Media', value: 'height', desc: 'Multiple Media Attachments' },
];

const TIME_RANGES: { label: string; value: TimeRangeOption }[] = [
  { label: 'All Time', value: 'all' },
  { label: 'Last 24 Hours / Daily Leader', value: '1d' },
  { label: 'This Week / Weekly Leader', value: '1w' },
  { label: 'This Month / Monthly Leader', value: '1m' },
  { label: 'This Year', value: '1y' },
];

const CUMST_SERVICE_OPTIONS: { label: string; value: CumstServiceOption; desc: string }[] = [
  { label: 'All', value: 'all', desc: 'All Platforms (OnlyFans & Fansly)' },
  { label: 'OnlyFans', value: 'onlyfans', desc: 'OnlyFans content only' },
  { label: 'Fansly', value: 'fansly', desc: 'Fansly content only' },
];

const CUMST_MEDIA_OPTIONS: { label: string; value: CumstMediaTypeOption; desc: string }[] = [
  { label: 'All', value: 'all', desc: 'All media types' },
  { label: 'Videos Only', value: 'videos', desc: 'Video clips and recordings' },
  { label: 'Photos Only', value: 'photos', desc: 'Images and galleries' },
  { label: 'Audio', value: 'audio', desc: 'Audio recordings' },
];

const RATING_OPTIONS: { label: string; value: RatingFilterOption }[] = [
  { label: 'All', value: 'all' },
  { label: 'Safe', value: 'safe' },
  { label: 'Questionable', value: 'questionable' },
  { label: 'Explicit (18+)', value: 'explicit' },
];

const MIN_SCORE_OPTIONS: { label: string; value: number | undefined }[] = [
  { label: 'Any', value: undefined },
  { label: '10+ Points', value: 10 },
  { label: '50+ Points', value: 50 },
  { label: '100+ Points', value: 100 },
  { label: '500+ Points', value: 500 },
];

/** On nhentai score = favorite count; scale is higher (thousands). */
const NHENTAI_MIN_SCORE_OPTIONS: { label: string; value: number | undefined }[] = [
  { label: 'Any', value: undefined },
  { label: '100+ Favorites', value: 100 },
  { label: '500+ Favorites', value: 500 },
  { label: '1,000+ Favorites', value: 1000 },
  { label: '5,000+ Favorites', value: 5000 },
  { label: '10,000+ Favorites', value: 10000 },
];

const SORT_OPTIONS_BY_TYPE: Record<string, { label: string; value: SortOption; desc: string }[]> = {
  redgifs: REDGIFS_SORT_OPTIONS,
  xvideos: XVIDEOS_SORT_OPTIONS,
  xhamster: XHAMSTER_SORT_OPTIONS,
  pornhub: PORNHUB_SORT_OPTIONS,
  sexcom: SEXCOM_SORT_OPTIONS,
  hentaihaven: HENTAIHAVEN_SORT_OPTIONS,
  nhentai: NHENTAI_SORT_OPTIONS,
  cumst: CUMST_SORT_OPTIONS,
};

function getSortOptionsForSource(source: BooruSource) {
  return SORT_OPTIONS_BY_TYPE[source.type] ?? SORT_OPTIONS;
}

interface SearchFilterModalProps {
  visible: boolean;
  filterConfig: SearchFilterConfig;
  activeSource: BooruSource;
  onSelectSource?: (source: BooruSource) => Promise<void>;
  onClose: () => void;
  onApply: (config: SearchFilterConfig) => void;
}

const SearchFilterModalComponent: React.FC<SearchFilterModalProps> = ({
  visible,
  filterConfig,
  activeSource: propSource,
  onSelectSource,
  onClose,
  onApply,
}) => {
  const insets = useSafeAreaInsets();
  const { selectSource } = useSource();
  const [draftSource, setDraftSource] = useState<BooruSource>(propSource);
  const activeSource = draftSource;
  const [draft, setDraft] = useState<SearchFilterConfig>(filterConfig);
  const [tagInput, setTagInput] = useState('');
  const [suggestions, setSuggestions] = useState<BooruTagSuggestion[]>([]);

  // Inline overlay picker state
  const [activePicker, setActivePicker] = useState<ActivePicker>(null);
  const [isSourceListOpen, setIsSourceListOpen] = useState(false);
  const [customDateText, setCustomDateText] = useState('');
  const [pageInputText, setPageInputText] = useState('');

  const overlayAnim = useRef(Animated?.Value ? new Animated.Value(0) : null).current;
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Sync draft only on false -> true transition so parent re-renders never wipe unsaved edits
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setDraft({ ...filterConfig });
      setDraftSource(propSource);
      setTagInput('');
      setSuggestions([]);
      setIsSourceListOpen(false);
      setActivePicker(null);
      setPageInputText(filterConfig.jumpToPage > 1 ? String(filterConfig.jumpToPage) : '');
    }
    wasVisibleRef.current = visible;
  }, [visible, filterConfig, propSource]);

  useEffect(() => {
    if (!activePicker || !overlayAnim || !Animated?.timing) return;
    overlayAnim.setValue(0);
    Animated.timing(overlayAnim, {
      toValue: 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [activePicker, overlayAnim]);

  const dismissPicker = useCallback(() => {
    if (activePicker === 'page') {
      setPageInputText(draft.jumpToPage > 1 ? String(draft.jumpToPage) : '');
    }
    setActivePicker(null);
  }, [activePicker, draft.jumpToPage]);

  const overlayBackdropStyle = useMemo(
    () => (overlayAnim ? { opacity: overlayAnim } : undefined),
    [overlayAnim]
  );

  const overlayCardStyle = useMemo(
    () =>
      overlayAnim
        ? {
            opacity: overlayAnim,
            transform: [
              {
                scale: overlayAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.96, 1],
                }),
              },
            ],
          }
        : undefined,
    [overlayAnim]
  );

  // Autocomplete from server for filter modal tag input
  useEffect(() => {
    if (!visible || !draft.autocompleteFromServer || !tagInput) {
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

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const list = await booruApi.searchTags(cleanToken, 12, activeSource);
        if (!cancelled) setSuggestions(list);
      } catch {
        if (!cancelled) setSuggestions([]);
      }
    }, 200);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [visible, tagInput, draft.autocompleteFromServer, activeSource]);

  const handleAddTag = (tagToAdd: string) => {
    // Parse multiple space- or comma-separated tags one by one;
    // a quoted group stays whole (tag:"big breasts" is not split)
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
    // nhentai: suggestions are added via the `tag:"name"` / `artist:"name"` mechanism
    // hentaihaven: suggestions are added via the `tag:...` or `artist:...` mechanism
    const qualified =
      activeSource.type === 'nhentai'
        ? nhentaiTagQuery(suggestedTag, category)
        : activeSource.type === 'hentaihaven'
          ? hentaiHavenTagQuery(suggestedTag, category)
          : suggestedTag.trim().toLowerCase();
    // Also pick up previously typed tokens, complete the last one with the suggestion
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
    setActivePicker(null);
  };

  const handleApplySearch = async () => {
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
    // Commit unsaved page input only if the user taps Apply while the page picker is open
    if (activePicker === 'page' && pageInputText.trim()) {
      const n = parseInt(pageInputText.replace(/[^0-9]/g, ''), 10);
      if (Number.isFinite(n) && n > 0) {
        finalDraft.jumpToPage = Math.min(n, 9999);
      }
    }
    if (draftSource.id !== propSource.id) {
      try {
        await (onSelectSource ?? selectSource)(draftSource);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!isMountedRef.current) return;
      } catch {
        Alert.alert('Could not switch source', 'Please try again.');
        return;
      }
    }
    onApplyRef.current(finalDraft);
  };

  const sortOptions = getSortOptionsForSource(activeSource);

  const getSortLabel = () => {
    const opt = sortOptions.find((s) => s.value === draft.sortBy);
    return opt ? opt.label : '---';
  };

  const getTimeLabel = () => {
    const opt = TIME_RANGES.find((t) => t.value === draft.timeRange);
    return opt ? opt.label : 'All Time';
  };

  const getRatingLabel = () => {
    const opt = RATING_OPTIONS.find((r) => r.value === draft.rating);
    return opt ? opt.label : 'All';
  };

  const getScoreLabel = () => {
    if (!draft.minScore) return '---';
    return `${draft.minScore}+`;
  };

  const getCumstServiceLabel = () => {
    const opt = CUMST_SERVICE_OPTIONS.find((s) => s.value === draft.cumstService);
    return opt ? opt.label : 'All';
  };

  const getCumstMediaLabel = () => {
    const opt = CUMST_MEDIA_OPTIONS.find((m) => m.value === draft.cumstMediaType);
    return opt ? opt.label : 'All';
  };

  const getDateLabel = () => describeAnchor(draft.leaderboardDate, draft.timeRange);

  // The date picker offers period-appropriate slots for the active time range:
  // weeks in weekly mode, months in monthly mode, days otherwise.
  const dateSlots = useMemo(() => {
    if (!visible || activePicker !== 'dateAnchor') return [];
    return draft.timeRange === '1w'
      ? weekDateOptions()
      : draft.timeRange === '1m'
        ? monthDateOptions()
        : dayDateOptions();
  }, [visible, activePicker, draft.timeRange]);
  const datePickerTitle =
    draft.timeRange === '1w'
      ? 'Select Week'
      : draft.timeRange === '1m'
        ? 'Select Month'
        : 'Select Past Date';

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'overFullScreen'}
      onRequestClose={() => {
        if (activePicker) dismissPicker();
        else onClose();
      }}
      onDismiss={onClose}
    >
      {visible ? (
      <KeyboardAvoidingView
        style={[
          styles.container,
          {
            paddingTop: Platform.OS === 'ios' ? 8 : insets.top + 8,
          },
        ]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Drag Handle Indicator (iOS pageSheet is natively swipeable) */}
        {Platform.OS === 'ios' && (
          <View style={styles.dragHandleContainer}>
            <View style={styles.dragHandle} />
          </View>
        )}

        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close filter modal"
            style={styles.circleBtn}
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X size={20} color="#FFFFFF" />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Filter</Text>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Apply filters"
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
                placeholder={draft.tags.length === 0 ? 'Add tag (e.g.: 1girl)...' : 'Add more...'}
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
              <ScrollView
                style={{ maxHeight: 200 }}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={true}
              >
                {suggestions.map((item, index) => (
                  <TouchableOpacity
                    key={`suggest-${item.name}-${index}`}
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
                ))}
              </ScrollView>
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
                  <View style={styles.sourceSummary}>
                    <SourceMark source={activeSource} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowLabel}>{activeSource.name}</Text>
                      <Text style={styles.serverUrlText} numberOfLines={1}>
                        {isSourceListOpen ? 'Choose a source below' : 'Tap to change source'}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.rowRight}>
                  <ChevronRight size={18} color={Colors.dark.textMuted} />
                </View>
              </TouchableOpacity>

              {isSourceListOpen && (
                <View style={{ padding: 12 }}>
                  <SourceCatalog
                    activeSource={activeSource}
                    onSelect={(source) => {
                      Haptics.selectionAsync();
                      setDraftSource(source);
                      setIsSourceListOpen(false);
                      setDraft((prev) => {
                        const options = getSortOptionsForSource(source);
                        return options.some((opt) => opt.value === prev.sortBy)
                          ? prev
                          : { ...prev, sortBy: 'default' };
                      });
                    }}
                  />
                </View>
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
                  setActivePicker('page');
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.rowLabel}>Jump to Page</Text>
                <View style={styles.rowRight}>
                  <Text style={styles.rowValue}>
                    {draft.jumpToPage > 1 ? `Page ${draft.jumpToPage}` : '---'}
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
                onPress={() => setActivePicker('sort')}
                activeOpacity={0.7}
              >
                <Text style={styles.rowLabel}>Sort by</Text>
                <View style={styles.rowRight}>
                  <Text style={styles.rowValue}>{getSortLabel()}</Text>
                  <ChevronRight size={18} color={Colors.dark.textMuted} />
                </View>
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Popularity Time Range / Leaderboard */}
              <TouchableOpacity
                style={styles.rowItem}
                onPress={() => setActivePicker('time')}
                activeOpacity={0.7}
              >
                <Text style={styles.rowLabel}>
                  {activeSource.type === 'cumst' ? 'Time Range (Leaderboard)' : 'Time Range (Popularity)'}
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

                  {/* Platform / Service Filter */}
                  <TouchableOpacity
                    style={styles.rowItem}
                    onPress={() => setActivePicker('cumstService')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.rowLabel}>Platform / Service</Text>
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
                    onPress={() => setActivePicker('cumstMedia')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.rowLabel}>Media Type</Text>
                    <View style={styles.rowRight}>
                      <Text style={[styles.rowValue, draft.cumstMediaType !== 'all' && { color: GOLD_ACCENT }]}>
                        {getCumstMediaLabel()}
                      </Text>
                      <ChevronRight size={18} color={Colors.dark.textMuted} />
                    </View>
                  </TouchableOpacity>

                  <View style={styles.rowDivider} />

                  {/* Historical Date Anchor (Past Leaderboard Date) */}
                  <TouchableOpacity
                    style={styles.rowItem}
                    onPress={() => {
                      setCustomDateText(draft.leaderboardDate || '');
                      setActivePicker('dateAnchor');
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.rowLabel}>Past Leaderboard Date (Archive)</Text>
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
                  {/* Rating: meaningless on nhentai since all content is 'e' (Explicit) */}
                  {activeSource.type !== 'nhentai' ? (
                    <>
                      <View style={styles.rowDivider} />

                      {/* Rating Filter */}
                      <TouchableOpacity
                        style={styles.rowItem}
                        onPress={() => setActivePicker('rating')}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.rowLabel}>Rating</Text>
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

                  {/* Min Score (on nhentai = favorite count) */}
                  <TouchableOpacity
                    style={styles.rowItem}
                    onPress={() => setActivePicker('score')}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.rowLabel}>
                      {activeSource.type === 'nhentai' ? 'Min Favorites (Score)' : 'Min Score'}
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

        {/* Inline Animated Picker Overlay (replaces stacked nested <Modal>s) */}
        {activePicker !== null && (
          <AnimatedView style={[styles.inlineOverlay, overlayBackdropStyle]}>
            <TouchableWithoutFeedback accessibilityLabel="Dismiss picker" onPress={dismissPicker}>
              <KeyboardAvoidingView
                style={styles.modalOverlay}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              >
                <TouchableWithoutFeedback>
                  <AnimatedView
                    style={[
                      styles.popoverCard,
                      activePicker === 'dateAnchor' && { maxHeight: '80%' },
                      overlayCardStyle,
                    ]}
                  >
                    {activePicker === 'sort' && (
                      <>
                        <Text style={styles.popoverTitle}>Sort by</Text>
                        <View style={styles.popoverList}>
                          {sortOptions.map((opt) => {
                            const isSelected = draft.sortBy === opt.value;
                            return (
                              <TouchableOpacity
                                key={opt.value}
                                style={[styles.popoverItem, isSelected && styles.popoverItemSelected]}
                                onPress={() => {
                                  Haptics.selectionAsync();
                                  setDraft((prev) => ({ ...prev, sortBy: opt.value }));
                                  setActivePicker(null);
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
                      </>
                    )}

                    {activePicker === 'time' && (
                      <>
                        <Text style={styles.popoverTitle}>Time Range</Text>
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
                                  setActivePicker(null);
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
                      </>
                    )}

                    {activePicker === 'rating' && (
                      <>
                        <Text style={styles.popoverTitle}>Rating</Text>
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
                                  setActivePicker(null);
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
                      </>
                    )}

                    {activePicker === 'score' && (
                      <>
                        <Text style={styles.popoverTitle}>
                          {activeSource.type === 'nhentai'
                            ? 'Minimum Favorites Count'
                            : 'Minimum Score'}
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
                                  setActivePicker(null);
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
                      </>
                    )}

                    {activePicker === 'page' && (
                      <>
                        <Text style={styles.popoverTitle}>Go to Page</Text>
                        <TextInput
                          style={styles.pageInput}
                          placeholder={`Page number (current: ${draft.jumpToPage})`}
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
                            <Text style={[styles.popoverItemText, styles.popoverItemTextSelected]}>Go</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.popoverItem}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setDraft((prev) => ({ ...prev, jumpToPage: 1 }));
                              setPageInputText('');
                              setActivePicker(null);
                            }}
                          >
                            <Text style={styles.popoverItemText}>Reset (1)</Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    )}

                    {activePicker === 'cumstService' && (
                      <>
                        <Text style={styles.popoverTitle}>Platform / Service</Text>
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
                                  setActivePicker(null);
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
                      </>
                    )}

                    {activePicker === 'cumstMedia' && (
                      <>
                        <Text style={styles.popoverTitle}>Media Type</Text>
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
                                  setActivePicker(null);
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
                      </>
                    )}

                    {activePicker === 'dateAnchor' && (
                      <>
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
                                      // Picking a date also picks the period time:
                                      // a weekly slot opens the weekly leaderboard, a monthly slot
                                      // the monthly leaderboard. Clearing keeps it as-is.
                                      timeRange: opt.value ? opt.range : prev.timeRange,
                                    }));
                                    setActivePicker(null);
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
                          <Text style={{ fontSize: 12, color: '#8E92A4', marginBottom: 6 }}>Custom Date (YYYY-MM-DD):</Text>
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
                              placeholder="E.g.: 2026-05-15"
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
                                  setActivePicker(null);
                                }
                              }}
                            >
                              <Text style={{ color: '#111216', fontWeight: '700', fontSize: 13 }}>Apply</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </>
                    )}
                  </AnimatedView>
                </TouchableWithoutFeedback>
              </KeyboardAvoidingView>
            </TouchableWithoutFeedback>
          </AnimatedView>
        )}
      </KeyboardAvoidingView>
      ) : null}
    </Modal>
  );
};

export const SearchFilterModal = React.memo(SearchFilterModalComponent);

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
  sourceInfo: {
    flex: 1,
    marginRight: 12,
  },
  sourceSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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

  /* Inline animated popover styles */
  inlineOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
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
