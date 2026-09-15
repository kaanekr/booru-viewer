import React, { useState, useEffect } from 'react';
import {
  Dimensions,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  X,
  Info as InfoIcon,
  Search,
  PlusCircle,
  MinusCircle,
  Copy,
  Clock,
  EyeOff,
  Pin,
  Check,
  ChevronRight,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { BooruPost, TagCategory } from '../types/booru';
import { StorageService } from '../services/storage';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GOLD_ACCENT = '#F5A623';

interface PostInfoModalProps {
  visible: boolean;
  post: BooruPost | null;
  onClose: () => void;
  onSearchTag: (tag: string) => void;
  onAddTagToSearch?: (tag: string) => void;
  onExcludeTagFromSearch?: (tag: string) => void;
}

interface TagItemData {
  name: string;
  category: TagCategory;
}

export const PostInfoModal: React.FC<PostInfoModalProps> = ({
  visible,
  post,
  onClose,
  onSearchTag,
  onAddTagToSearch,
  onExcludeTagFromSearch,
}) => {
  const insets = useSafeAreaInsets();
  const [selectedTag, setSelectedTag] = useState<TagItemData | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ y: number }>({ y: 200 });
  const [isTagFav, setIsTagFav] = useState(false);
  const [isTagBlacklisted, setIsTagBlacklisted] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (selectedTag) {
      StorageService.isFavoriteTag(selectedTag.name).then(setIsTagFav);
      StorageService.isBlacklistedTag(selectedTag.name).then(setIsTagBlacklisted);
    }
  }, [selectedTag]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2200);
  };

  if (!post) return null;

  // Build ordered tag list with categories
  const allTagItems: TagItemData[] = [];
  const seen = new Set<string>();

  const addCategoryTags = (tags: string[], category: TagCategory) => {
    tags.forEach((t) => {
      const clean = t.trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        allTagItems.push({ name: clean, category });
      }
    });
  };

  addCategoryTags(post.tags.copyright || [], 'copyright');
  addCategoryTags(post.tags.character || [], 'character');
  addCategoryTags(post.tags.artist || [], 'artist');
  addCategoryTags(post.tags.general || [], 'general');
  addCategoryTags(post.tags.meta || [], 'meta');

  // Fallback for uncategorized
  if (allTagItems.length === 0 && post.allTags && post.allTags.length > 0) {
    post.allTags.forEach((t) => {
      const clean = t.trim();
      if (clean && !seen.has(clean)) {
        seen.add(clean);
        allTagItems.push({ name: clean, category: 'general' });
      }
    });
  }

  const getTagColor = (category: TagCategory) => {
    switch (category) {
      case 'copyright':
        return '#D2A8FF'; // Purple / Magenta
      case 'character':
        return '#7EE787'; // Green
      case 'artist':
        return '#FF7B72'; // Red / Coral
      case 'meta':
        return '#F5A623'; // Gold / Orange
      case 'general':
      default:
        return '#58A6FF'; // Blue
    }
  };

  const formatPostedDate = (createdAt?: string) => {
    if (!createdAt) return 'Bilinmiyor';
    try {
      const d = new Date(isNaN(Number(createdAt)) ? createdAt : Number(createdAt) * 1000);
      if (isNaN(d.getTime())) return createdAt;
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const day = d.getDate();
      const month = months[d.getMonth()];
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const mins = String(d.getMinutes()).padStart(2, '0');
      return `${day} ${month} ${year} at ${hours}:${mins}`;
    } catch {
      return createdAt;
    }
  };

  const getRatingLabel = (rating?: string) => {
    switch (rating) {
      case 's':
      case 'g':
        return 'general';
      case 'q':
        return 'questionable';
      case 'e':
        return 'explicit';
      default:
        return 'general';
    }
  };

  // Actions
  const handleCopyText = async (text: string, label: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await Clipboard.setStringAsync(text);
    showToast(`📋 ${label} kopyalandı!`);
  };

  const handleOpenUrl = async (url?: string) => {
    if (!url) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        await handleCopyText(url, 'Bağlantı');
      }
    } catch {
      await handleCopyText(url, 'Bağlantı');
    }
  };

  const handleOpenTagMenu = (item: TagItemData, event: any) => {
    const pageY = event?.nativeEvent?.pageY || 200;
    setMenuPosition({ y: pageY });
    setSelectedTag(item);
  };

  const handleTagSearch = (tag: string) => {
    Haptics.selectionAsync();
    setSelectedTag(null);
    onClose();
    setTimeout(() => {
      onSearchTag(tag);
    }, 60);
  };

  const handleTagAddToSearch = (tag: string) => {
    Haptics.selectionAsync();
    setSelectedTag(null);
    onClose();
    setTimeout(() => {
      if (onAddTagToSearch) {
        onAddTagToSearch(tag);
      } else {
        onSearchTag(tag);
      }
    }, 60);
  };

  const handleTagExcludeFromSearch = (tag: string) => {
    Haptics.selectionAsync();
    setSelectedTag(null);
    onClose();
    setTimeout(() => {
      if (onExcludeTagFromSearch) {
        onExcludeTagFromSearch(tag);
      } else {
        onSearchTag(`-${tag}`);
      }
    }, 60);
  };

  const handleToggleTagFavorite = async (tag: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const newState = await StorageService.toggleFavoriteTag(tag);
    setIsTagFav(newState);
    showToast(newState ? `⭐ "${tag}" favori etiketlere eklendi!` : `"${tag}" favorilerden çıkarıldı.`);
    setSelectedTag(null);
  };

  const handleToggleBlacklist = async (tag: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const newState = await StorageService.toggleBlacklistedTag(tag);
    setIsTagBlacklisted(newState);
    showToast(newState ? `🚫 "${tag}" kara listeye eklendi!` : `"${tag}" kara listeden çıkarıldı.`);
    setSelectedTag(null);
  };

  const handleSaveToHistory = async (tag: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await StorageService.addSearchHistory(tag);
    showToast(`🕒 "${tag}" arama geçmişine kaydedildi!`);
    setSelectedTag(null);
  };

  // Resolution data
  const normalExt = post.sampleUrl ? post.sampleUrl.split('.').pop() || 'jpg' : 'jpg';
  const originalExt = post.fileExt || (post.originalUrl ? post.originalUrl.split('.').pop() || 'png' : 'png');
  const sampleWidth = Math.round(post.width > 1200 ? post.width * 0.5 : post.width);
  const sampleHeight = Math.round(post.height > 1200 ? post.height * 0.5 : post.height);

  // Dynamic menu positioning based on touch Y
  const MENU_CARD_HEIGHT = 350;
  const menuTop = Math.min(
    Math.max(menuPosition.y - 40, insets.top + 50),
    SCREEN_HEIGHT - insets.bottom - MENU_CARD_HEIGHT - 20
  );

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
            paddingBottom: insets.bottom,
          },
        ]}
      >
        {/* Toast Notification */}
        {toastMessage && (
          <View style={[styles.toastContainer, { top: insets.top + 56 }]}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        )}

        {/* Drag Handle Indicator */}
        <View style={styles.dragHandleContainer}>
          <View style={styles.dragHandle} />
        </View>

        {/* Top Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.circleBtn}
            onPress={onClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X size={20} color="#FFFFFF" />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Info</Text>

          {/* Balance spacer */}
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          style={styles.scrollArea}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* 1. POST SECTION */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Post</Text>

            <View style={styles.sectionBody}>
              {/* Normal (jpg) */}
              <TouchableOpacity
                style={styles.postRowItem}
                onPress={() => handleCopyText(post.sampleUrl || post.previewUrl, 'Normal Görsel URL')}
                activeOpacity={0.7}
              >
                <View style={styles.postRowLeft}>
                  <Text style={styles.normalLabel}>Normal ({normalExt})</Text>
                  <Text style={styles.postRowSubtitle}>
                    {sampleWidth}px X {sampleHeight}px
                  </Text>
                </View>
                <View style={styles.yellowInfoBadge}>
                  <InfoIcon size={13} color={GOLD_ACCENT} />
                </View>
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Original (png/jpg/mp4) */}
              <TouchableOpacity
                style={styles.postRowItem}
                onPress={() => handleCopyText(post.originalUrl || post.sampleUrl, 'Orijinal Görsel URL')}
                activeOpacity={0.7}
              >
                <View style={styles.postRowLeft}>
                  <Text style={styles.originalLabel}>Original ({originalExt})</Text>
                  <Text style={styles.postRowSubtitle}>
                    {post.width}px X {post.height}px
                  </Text>
                </View>
                <View style={styles.yellowInfoBadge}>
                  <InfoIcon size={13} color={GOLD_ACCENT} />
                </View>
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Source Link */}
              <TouchableOpacity
                style={styles.postRowItem}
                onPress={() => {
                  if (post.sourceLink) handleOpenUrl(post.sourceLink);
                  else showToast('Kaynak bağlantısı mevcut değil');
                }}
                activeOpacity={0.7}
              >
                <View style={styles.postRowLeft}>
                  <Text style={styles.fieldLabel}>Source</Text>
                  <Text style={styles.postRowSubtitle} numberOfLines={1}>
                    {post.sourceLink || 'Bilinmiyor / Yok'}
                  </Text>
                </View>
                <View style={styles.yellowInfoBadge}>
                  <InfoIcon size={13} color={GOLD_ACCENT} />
                </View>
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Post URL */}
              <TouchableOpacity
                style={styles.postRowItem}
                onPress={() => handleCopyText(post.originalUrl || post.sampleUrl, 'Görsel URL')}
                activeOpacity={0.7}
              >
                <View style={styles.postRowLeft}>
                  <Text style={styles.fieldLabel}>URL</Text>
                  <Text style={styles.postRowSubtitle} numberOfLines={1}>
                    {post.originalUrl || post.sampleUrl}
                  </Text>
                </View>
                <View style={styles.yellowInfoBadge}>
                  <InfoIcon size={13} color={GOLD_ACCENT} />
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* 2. TAGS SECTION (Direct Tap: Search | 3 Dots: Options Menu) */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Tags</Text>

            <View style={styles.sectionBody}>
              {allTagItems.map((item, idx) => {
                const color = getTagColor(item.category);
                return (
                  <React.Fragment key={`info-tag-${item.name}-${idx}`}>
                    {idx > 0 && <View style={styles.rowDivider} />}
                    <TouchableOpacity
                      style={styles.tagRowItem}
                      onPress={() => handleTagSearch(item.name)}
                      onLongPress={(e) => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        handleOpenTagMenu(item, e);
                      }}
                      delayLongPress={300}
                      activeOpacity={0.6}
                    >
                      <Text style={[styles.tagNameText, { color }]} numberOfLines={1}>
                        {item.name}
                      </Text>

                      <TouchableOpacity
                        style={styles.yellowDotsBadge}
                        onPress={(e) => handleOpenTagMenu(item, e)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        activeOpacity={0.7}
                      >
                        <View style={styles.dot} />
                        <View style={styles.dot} />
                        <View style={styles.dot} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  </React.Fragment>
                );
              })}
            </View>
          </View>

          {/* 3. OTHER SECTION */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Other</Text>

            <View style={styles.sectionBody}>
              {/* ID */}
              <TouchableOpacity
                style={styles.otherRowItem}
                onPress={() => handleCopyText(post.id, 'Post ID')}
                activeOpacity={0.7}
              >
                <Text style={styles.otherLabel}>ID</Text>
                <Text style={styles.otherValue}>{post.id}</Text>
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Posted */}
              <View style={styles.otherRowItem}>
                <Text style={styles.otherLabel}>Posted</Text>
                <Text style={styles.otherValue}>{formatPostedDate(post.createdAt)}</Text>
              </View>

              <View style={styles.rowDivider} />

              {/* Score */}
              <View style={styles.otherRowItem}>
                <Text style={styles.otherLabel}>Score</Text>
                <Text style={styles.otherValue}>{post.score ?? 0}</Text>
              </View>

              <View style={styles.rowDivider} />

              {/* Rating */}
              <View style={styles.otherRowItem}>
                <Text style={styles.otherLabel}>Rating</Text>
                <Text style={styles.otherValue}>{getRatingLabel(post.rating)}</Text>
              </View>

              <View style={styles.rowDivider} />

              {/* Notes */}
              <View style={styles.otherRowItem}>
                <Text style={styles.otherLabel}>Notes</Text>
                <Text style={styles.otherValue}>No</Text>
              </View>

              <View style={styles.rowDivider} />

              {/* Childs */}
              <View style={styles.otherRowItem}>
                <Text style={styles.otherLabel}>Childs</Text>
                <Text style={styles.otherValue}>No</Text>
              </View>

              <View style={styles.rowDivider} />

              {/* Parent ID */}
              <View style={[styles.otherRowItem, styles.otherRowItemFlex]}>
                <View>
                  <Text style={styles.otherLabel}>Parent ID</Text>
                  <Text style={styles.otherValue}>0</Text>
                </View>
                <ChevronRight size={16} color="#7E8494" />
              </View>
            </View>
          </View>
        </ScrollView>

        {/* 4. FLOATING TAG CONTEXT MENU (In-View Overlay - No nested Modal) */}
        {selectedTag !== null && (
          <TouchableWithoutFeedback onPress={() => setSelectedTag(null)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.anchoredMenuCard, { top: menuTop }]}>
                  {/* Tag Name Header in Popover */}
                  <View style={styles.menuHeader}>
                    <Text style={styles.menuHeaderText} numberOfLines={1}>
                      {selectedTag.name}
                    </Text>
                  </View>

                  <View style={styles.menuDivider} />

                  <View style={styles.menuList}>
                    {/* 1. Search */}
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => handleTagSearch(selectedTag.name)}
                      activeOpacity={0.7}
                    >
                      <Search size={16} color="#E6EDF3" />
                      <Text style={styles.menuItemText}>Search</Text>
                    </TouchableOpacity>

                    {/* 2. Add to Search */}
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => handleTagAddToSearch(selectedTag.name)}
                      activeOpacity={0.7}
                    >
                      <PlusCircle size={16} color="#E6EDF3" />
                      <Text style={styles.menuItemText}>Add to Search</Text>
                    </TouchableOpacity>

                    {/* 3. Exclude from Search */}
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => handleTagExcludeFromSearch(selectedTag.name)}
                      activeOpacity={0.7}
                    >
                      <MinusCircle size={16} color="#E6EDF3" />
                      <Text style={styles.menuItemText}>Exclude from Search</Text>
                    </TouchableOpacity>

                    {/* 4. Copy */}
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => {
                        handleCopyText(selectedTag.name, 'Etiket');
                        setSelectedTag(null);
                      }}
                      activeOpacity={0.7}
                    >
                      <Copy size={16} color="#E6EDF3" />
                      <Text style={styles.menuItemText}>Copy</Text>
                    </TouchableOpacity>

                    {/* 5. Save to History */}
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => handleSaveToHistory(selectedTag.name)}
                      activeOpacity={0.7}
                    >
                      <Clock size={16} color="#E6EDF3" />
                      <Text style={styles.menuItemText}>Save to History</Text>
                    </TouchableOpacity>

                    {/* 6. Add to Blacklist */}
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => handleToggleBlacklist(selectedTag.name)}
                      activeOpacity={0.7}
                    >
                      <EyeOff size={16} color={isTagBlacklisted ? '#FF4D4F' : '#E6EDF3'} />
                      <Text style={[styles.menuItemText, isTagBlacklisted && { color: '#FF4D4F' }]}>
                        {isTagBlacklisted ? 'Remove Blacklist' : 'Add to Blacklist'}
                      </Text>
                      <ChevronRight size={14} color="#7E8494" style={{ marginLeft: 'auto' }} />
                    </TouchableOpacity>

                    {/* 7. Pin to Favorite Tags */}
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => handleToggleTagFavorite(selectedTag.name)}
                      activeOpacity={0.7}
                    >
                      <Pin size={16} color={isTagFav ? GOLD_ACCENT : '#E6EDF3'} />
                      <Text style={[styles.menuItemText, isTagFav && { color: GOLD_ACCENT }]}>
                        {isTagFav ? 'Unpin Tag' : 'Pin to...'}
                      </Text>
                      {isTagFav && <Check size={14} color={GOLD_ACCENT} style={{ marginLeft: 'auto' }} />}
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#141518',
  },
  dragHandleContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 2,
  },
  dragHandle: {
    width: 36,
    height: 4.5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  circleBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#262830',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 38,
    height: 38,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.2,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 40,
  },
  sectionContainer: {
    marginTop: 18,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  sectionBody: {
    backgroundColor: '#18191E',
    borderRadius: 14,
    overflow: 'hidden',
  },
  postRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  postRowLeft: {
    flex: 1,
    marginRight: 12,
  },
  normalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: GOLD_ACCENT,
    marginBottom: 2,
  },
  originalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  postRowSubtitle: {
    fontSize: 12,
    color: '#7E8494',
    lineHeight: 16,
  },
  yellowInfoBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: GOLD_ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginLeft: 16,
  },
  tagRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tagNameText: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    marginRight: 12,
  },
  yellowDotsBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: GOLD_ACCENT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dot: {
    width: 2.5,
    height: 2.5,
    borderRadius: 1.5,
    backgroundColor: GOLD_ACCENT,
  },
  otherRowItem: {
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  otherRowItemFlex: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  otherLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 1,
  },
  otherValue: {
    fontSize: 12,
    color: '#7E8494',
  },

  /* Floating Popover Overlay (in-view) */
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    zIndex: 1000,
    elevation: 20,
  },
  anchoredMenuCard: {
    position: 'absolute',
    right: 16,
    width: 240,
    backgroundColor: '#262832',
    borderRadius: 18,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 16,
  },
  menuHeader: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  menuHeaderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8E92A4',
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginHorizontal: 4,
    marginBottom: 4,
  },
  menuList: {
    gap: 1,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  menuItemText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#E6EDF3',
  },

  /* Toast Notification */
  toastContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    backgroundColor: '#262A36',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
    borderWidth: 1,
    borderColor: GOLD_ACCENT,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 10,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
});
