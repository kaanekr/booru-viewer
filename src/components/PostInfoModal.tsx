import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Animated,
  Linking,
  Modal,
  PanResponder,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
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
import { StorageService, ImageQuality } from '../services/storage';
import { nhentaiTagQuery } from '../services/nhentai';
import { hentaiHavenTagQuery, isHentaiHavenOfficialGenre } from '../services/hentaihavens';
import { resolveRealDimensions } from '../utils/media';
import { onlyStrings } from '../utils/guards';

const GOLD_ACCENT = '#F5A623';
/** Down-drag threshold at which the sheet closes on release */
const DISMISS_THRESHOLD = 130;

interface PostInfoModalProps {
  visible: boolean;
  post: BooruPost | null;
  onClose: () => void;
  onSearchTag: (tag: string) => void;
  onAddTagToSearch?: (tag: string) => void;
  onExcludeTagFromSearch?: (tag: string) => void;
  onPreviewOriginal?: (post: BooruPost) => void;
  useModal?: boolean;
  isPeeking?: boolean;
  externalTranslateY?: Animated.Value;
}

interface TagItemData {
  name: string;
  category: TagCategory;
}

export const PostInfoModal: React.FC<PostInfoModalProps> = React.memo(({
  visible,
  post,
  onClose,
  onSearchTag,
  onAddTagToSearch,
  onExcludeTagFromSearch,
  onPreviewOriginal,
  useModal = true,
  isPeeking = false,
  externalTranslateY,
}) => {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const windowHeightRef = useRef(windowHeight);
  windowHeightRef.current = windowHeight;
  const insetTop = insets.top ?? 0;
  const insetBottom = insets.bottom ?? 0;
  const insetLeft = insets.left ?? 0;
  const insetRight = insets.right ?? 0;
  const sheetMaxHeight = Math.round(windowHeight * 0.92);
  const sheetMaxHeightRef = useRef(sheetMaxHeight);
  sheetMaxHeightRef.current = sheetMaxHeight;

  const [selectedTag, setSelectedTag] = useState<TagItemData | null>(null);
  const selectedTagRef = useRef<TagItemData | null>(null);
  selectedTagRef.current = selectedTag;
  const [menuPosition, setMenuPosition] = useState<{ y: number }>({ y: 200 });
  const [isTagFav, setIsTagFav] = useState(false);
  const [isTagBlacklisted, setIsTagBlacklisted] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }
      setToastMessage(null);
      setSelectedTag(null);
    }
  }, [visible]);

  useEffect(() => {
    setIsTagFav(false);
    setIsTagBlacklisted(false);
    if (!selectedTag) return;
    let active = true;
    StorageService.isFavoriteTag(selectedTag.name)
      .then((val) => {
        if (active) setIsTagFav(val);
      })
      .catch(() => {});
    StorageService.isBlacklistedTag(selectedTag.name)
      .then((val) => {
        if (active) setIsTagBlacklisted(val);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [selectedTag]);

  // Show which quality mode matches the on-screen image:
  // read the viewer quality setting (Normal = sample, Original = full)
  const [viewQuality, setViewQuality] = useState<ImageQuality>('auto');

  useEffect(() => {
    if (!visible) return;
    let active = true;
    StorageService.getImageQuality()
      .then((q) => {
        if (active) setViewQuality(q);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [visible]);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage(msg);
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToastMessage(null);
    }, 2200);
  }, []);

  // --- Drag-to-dismiss infrastructure (Animated + PanResponder, Expo Go compatible) ---
  const internalTranslateY = useRef(new Animated.Value(windowHeight)).current;
  const translateY = externalTranslateY ?? internalTranslateY;
  const scrollViewRef = useRef<ScrollViewInstance>(null);
  const scrollOffsetY = useRef(0);
  const dragStartDyRef = useRef<number | null>(null);
  const closing = useRef(false);

  const setNativeScrollEnabled = useCallback((enabled: boolean) => {
    try {
      (scrollViewRef.current as any)?.setNativeProps?.({ scrollEnabled: enabled });
    } catch {}
  }, []);

  // onClose is not called before the close animation finishes — otherwise
  // the Modal unmounts instantly and the exit animation dies.
  const dismissThen = useCallback((cb?: () => void) => {
    if (closing.current) {
      cb?.();
      return;
    }
    closing.current = true;
    setNativeScrollEnabled(false);
    Animated.timing(translateY, {
      toValue: sheetMaxHeightRef.current || windowHeightRef.current,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      closing.current = false;
      setNativeScrollEnabled(true);
      onClose();
      cb?.();
    });
  }, [onClose, setNativeScrollEnabled, translateY]);

  const requestClose = useCallback(() => dismissThen(), [dismissThen]);

  // Opening: spring smoothly from current position (supports interactive pull-up)
  useEffect(() => {
    if (visible) {
      closing.current = false;
      scrollOffsetY.current = 0;
      dragStartDyRef.current = null;
      setNativeScrollEnabled(true);
      if (!externalTranslateY) {
        translateY.setValue(sheetMaxHeightRef.current || windowHeightRef.current);
      }
      Animated.spring(translateY, {
        toValue: 0,
        damping: 28,
        stiffness: 320,
        mass: 0.85,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, translateY, externalTranslateY, setNativeScrollEnabled]);

  // Catch pull-down when the inner ScrollView is at the top, track finger 1:1
  // without jumping or triggering React state re-renders mid-drag.
  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          !closing.current &&
          !selectedTagRef.current &&
          gesture.dy > 5 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx) &&
          scrollOffsetY.current <= 0,
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          !closing.current &&
          !selectedTagRef.current &&
          gesture.dy > 5 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.15 &&
          scrollOffsetY.current <= 0,
        onPanResponderGrant: (_, gesture) => {
          dragStartDyRef.current = gesture?.dy ?? 0;
          (translateY as any).stopAnimation?.();
          setNativeScrollEnabled(false);
        },
        onPanResponderMove: (_, gesture) => {
          const deltaY = gesture.dy - (dragStartDyRef.current ?? 0);
          // Resist upward pushes, track downward ones 1:1 from zero
          translateY.setValue(deltaY > 0 ? deltaY : deltaY * 0.2);
        },
        onPanResponderRelease: (_, gesture) => {
          const startDy = dragStartDyRef.current ?? 0;
          dragStartDyRef.current = null;
          const deltaY = gesture.dy - startDy;
          setNativeScrollEnabled(true);
          if (deltaY > DISMISS_THRESHOLD || gesture.vy > 0.55) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            dismissThen();
          } else {
            Animated.spring(translateY, {
              toValue: 0,
              damping: 28,
              stiffness: 320,
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          dragStartDyRef.current = null;
          setNativeScrollEnabled(true);
          Animated.spring(translateY, {
            toValue: 0,
            damping: 28,
            stiffness: 320,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [translateY, dismissThen, setNativeScrollEnabled]
  );

  const backdropOpacity = useMemo(
    () =>
      translateY.interpolate({
        inputRange: [0, Math.max(1, sheetMaxHeight)],
        outputRange: [0.55, 0],
        extrapolate: 'clamp',
      }),
    [translateY, sheetMaxHeight]
  );

  // Build ordered tag list with categories
  const allTagItems = useMemo<TagItemData[]>(() => {
    const items: TagItemData[] = [];
    const seen = new Set<string>();

    const addCategoryTags = (tags: unknown, category: TagCategory) => {
      onlyStrings(tags).forEach((t) => {
        const clean = t.trim();
        if (clean && !seen.has(clean)) {
          seen.add(clean);
          items.push({ name: clean, category });
        }
      });
    };

    if (post) {
      addCategoryTags(post.tags?.copyright || [], 'copyright');
      addCategoryTags(post.tags?.character || [], 'character');
      addCategoryTags(post.tags?.artist || [], 'artist');
      addCategoryTags(post.tags?.general || [], 'general');
      addCategoryTags(post.tags?.meta || [], 'meta');

      // Fallback for uncategorized
      if (items.length === 0 && post.allTags && post.allTags.length > 0) {
        onlyStrings(post.allTags).forEach((t) => {
          const clean = t.trim();
          if (clean && !seen.has(clean)) {
            seen.add(clean);
            items.push({ name: clean, category: 'general' });
          }
        });
      }
    }

    return items;
  }, [post]);

  const getTagColor = (category: TagCategory, name?: string) => {
    // HentaiHaven official genres (/genres/) stand apart from other general tags
    if (
      category === 'general' &&
      post?.sourceId === 'hentaihaven' &&
      isHentaiHavenOfficialGenre(name)
    ) {
      return '#39C5CF'; // Teal: official genre
    }
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
    if (!createdAt) return 'Unknown';
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
    showToast(`📋 ${label} copied!`);
  };

  const handleOpenUrl = async (url?: string) => {
    if (!url) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        await handleCopyText(url, 'Link');
      }
    } catch {
      await handleCopyText(url, 'Link');
    }
  };

  const handleOpenTagMenu = (item: TagItemData, event: any) => {
    const pageY = event?.nativeEvent?.pageY || 200;
    setMenuPosition({ y: pageY });
    setSelectedTag(item);
  };

  const handleTagSearch = (tag: string, category?: TagCategory) => {
    Haptics.selectionAsync();
    setSelectedTag(null);
    // Searching a RedGifs artist-name tag returns 0; search via the 'user:' mechanism
    // nhentai: search via the `tag:"name"` / `artist:"name"` mechanism by category
    // (a plain word matches full-text, not tag matches)
    // hentaihaven: a spaced genre becomes `tag:"name"`, otherwise it would split into words
    const isNhentai = post?.sourceId === 'nhentai' && !/^[a-z][a-z-]*:/i.test(tag);
    const isHentaiHaven = post?.sourceId === 'hentaihaven' && !/^[a-z][a-z-]*:/i.test(tag);
    const query =
      category === 'artist' && post?.sourceId === 'redgifs' && !tag.toLowerCase().startsWith('user:')
        ? `user:${tag}`
        : isNhentai
          ? nhentaiTagQuery(tag, category)
          : isHentaiHaven
            ? hentaiHavenTagQuery(tag, category)
            : tag;
    dismissThen(() => onSearchTag(query));
  };

  const isRedGifsArtist = (name: string, category?: TagCategory) =>
    category === 'artist' && post?.sourceId === 'redgifs' && !name.toLowerCase().startsWith('user:');

  const handleTagAddToSearch = (tag: string, category?: TagCategory) => {
    Haptics.selectionAsync();
    setSelectedTag(null);
    // A RedGifs artist is added to search as a user
    const isHentaiHavenAdd = post?.sourceId === 'hentaihaven' && !/^[a-z][a-z-]*:/i.test(tag);
    const query = isRedGifsArtist(tag, category)
      ? `user:${tag}`
      : post?.sourceId === 'nhentai' && !/^[a-z][a-z-]*:/i.test(tag)
        ? nhentaiTagQuery(tag, category)
        : isHentaiHavenAdd
          ? hentaiHavenTagQuery(tag, category)
          : tag;
    dismissThen(() => {
      if (onAddTagToSearch) {
        onAddTagToSearch(query);
      } else {
        onSearchTag(query);
      }
    });
  };

  const handleTagExcludeFromSearch = (tag: string, category?: TagCategory) => {
    Haptics.selectionAsync();
    setSelectedTag(null);
    // A RedGifs artist is excluded as '-user:'
    // nhentai: `-tag:"name"` (a multi-word tag stays whole like `-"a b"`)
    // hentaihaven: `-artist:"name"` or `-tag:"name"`
    const isHentaiHavenEx = post?.sourceId === 'hentaihaven' && !/^(-|[a-z][a-z-]*:)/i.test(tag);
    const query = isRedGifsArtist(tag, category)
      ? `-user:${tag}`
      : post?.sourceId === 'nhentai' && !/^(-|[a-z][a-z-]*:)/i.test(tag)
        ? `-${nhentaiTagQuery(tag, category)}`
        : isHentaiHavenEx
          ? `-${hentaiHavenTagQuery(tag, category)}`
          : `-${tag}`;
    dismissThen(() => {
      if (onExcludeTagFromSearch) {
        onExcludeTagFromSearch(query);
      } else {
        onSearchTag(query);
      }
    });
  };

  const handleToggleTagFavorite = async (tag: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const newState = await StorageService.toggleFavoriteTag(tag);
    setIsTagFav(newState);
    showToast(newState ? `⭐ "${tag}" added to favorite tags!` : `"${tag}" removed from favorites.`);
    setSelectedTag(null);
  };

  const handleToggleBlacklist = async (tag: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    const newState = await StorageService.toggleBlacklistedTag(tag);
    setIsTagBlacklisted(newState);
    showToast(newState ? `🚫 "${tag}" added to blacklist!` : `"${tag}" removed from blacklist.`);
    setSelectedTag(null);
  };

  const handleSaveToHistory = async (tag: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await StorageService.addSearchHistory(tag);
    showToast(`🕒 "${tag}" saved to search history!`);
    setSelectedTag(null);
  };

  // Resolution data
  const normalExt = typeof post?.sampleUrl === 'string' && post.sampleUrl ? post.sampleUrl.split('.').pop() || 'jpg' : 'jpg';
  const originalExt =
    typeof post?.fileExt === 'string' && post.fileExt
      ? post.fileExt
      : typeof post?.originalUrl === 'string' && post.originalUrl
        ? post.originalUrl.split('.').pop() || 'png'
        : 'png';
  const [resolvedDims, setResolvedDims] = useState<{ w: number; h: number } | null>(null);
  const [resolvedBytes, setResolvedBytes] = useState<number | null>(null);

  const currentW = resolvedDims?.w || post?.width || 0;
  const currentH = resolvedDims?.h || post?.height || 0;
  const sampleWidth = Math.round(currentW > 1200 ? currentW * 0.5 : currentW);
  const sampleHeight = Math.round(currentH > 1200 ? currentH * 0.5 : currentH);

  const formatBytes = (b: number | null | undefined): string | null => {
    if (b === null || b === undefined || !Number.isFinite(b) || b <= 0) return null;
    if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.max(1, Math.round(b / 1024))} KB`;
  };

  const handlePreviewOriginal = () => {
    if (!onPreviewOriginal || !post) return;
    Haptics.selectionAsync();
    dismissThen(() => onPreviewOriginal(post));
  };

  // Real dimensions: scrape leaves an 800x1000 placeholder, resolve from the post page
  useEffect(() => {
    if (!visible || !post) return;
    setResolvedDims(null);
    setResolvedBytes(post.fileSize && post.fileSize > 0 ? post.fileSize : null);
    const looksPlaceholder =
      (post.width === 800 && post.height === 1000) ||
      post.sourceId === 'gelbooru' ||
      post.id?.startsWith('gelbooru_') ||
      !post.width ||
      !post.height ||
      !post.fileSize;
    if (!looksPlaceholder || !post.sourceLink) return;
    let mounted = true;
    resolveRealDimensions(post).then((dims) => {
      if (!mounted) return;
      if (dims) setResolvedDims(dims);
      if (dims?.bytes && dims.bytes > 0) setResolvedBytes(dims.bytes);
    });
    return () => {
      mounted = false;
    };
  }, [post?.id, visible]);

  // Dynamic menu positioning based on touch Y
  const MENU_CARD_HEIGHT = 350;
  const minMenuTop = insetTop + 50;
  const maxMenuTop = Math.max(minMenuTop, windowHeight - insetBottom - MENU_CARD_HEIGHT - 20);
  const menuTop = Math.min(Math.max(menuPosition.y - 40, minMenuTop), maxMenuTop);

  if (!post) return null;
  if (!useModal && !visible && !isPeeking) return null;

  const sheetContent = (
    <View
      style={[styles.backdropContainer, { paddingTop: insetTop }, !useModal && styles.inlineOverlay]}
      pointerEvents={visible || isPeeking ? 'auto' : 'none'}
    >
        <TouchableWithoutFeedback onPress={requestClose}>
          <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]} />
        </TouchableWithoutFeedback>
        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetMaxHeight,
              maxHeight: '100%',
              transform: [{ translateY }],
              paddingTop: 8,
            },
          ]}
          {...sheetPanResponder.panHandlers}
        >
        {/* Toast Notification */}
        {toastMessage && (
          <View style={[styles.toastContainer, { top: 56 }]}>
            <Text style={styles.toastText}>{toastMessage}</Text>
          </View>
        )}

        {/* Drag Handle Indicator */}
        <View style={styles.dragHandleContainer}>
          <View style={styles.dragHandle} />
        </View>

        {/* Top Header */}
        <View style={[styles.header, { paddingLeft: insetLeft + 16, paddingRight: insetRight + 16 }]}>
          <TouchableOpacity
            style={styles.circleBtn}
            onPress={requestClose}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <X size={20} color="#FFFFFF" />
          </TouchableOpacity>

          <Text style={styles.headerTitle}>Info</Text>

          {/* Balance spacer */}
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollArea}
          bounces={false}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingBottom: insetBottom + 40,
              paddingLeft: insetLeft + 16,
              paddingRight: insetRight + 16,
            },
          ]}
          showsVerticalScrollIndicator={true}
          scrollEventThrottle={16}
          onScroll={(e) => {
            scrollOffsetY.current = e.nativeEvent.contentOffset.y;
          }}
        >
          {/* 1. POST SECTION */}
          <View style={styles.sectionContainer}>
            <Text style={styles.sectionTitle}>Post</Text>

            <View style={styles.sectionBody}>
              {/* Title (video sources) — tap to copy */}
              {post.title ? (
                <>
                  <TouchableOpacity
                    style={styles.postRowItem}
                    onPress={() => handleCopyText(post.title || '', 'Title')}
                    activeOpacity={0.7}
                  >
                    <View style={styles.postRowLeft}>
                      <Text style={styles.fieldLabel}>Title</Text>
                      <Text style={styles.postRowSubtitle} numberOfLines={3}>
                        {post.title}
                      </Text>
                    </View>
                    <View style={styles.yellowInfoBadge}>
                      <InfoIcon size={13} color={GOLD_ACCENT} />
                    </View>
                  </TouchableOpacity>

                  <View style={styles.rowDivider} />
                </>
              ) : null}

              {/* Normal (jpg) — yellow highlight when active */}
              <TouchableOpacity
                style={styles.postRowItem}
                onPress={() => handleCopyText(post.sampleUrl || post.previewUrl, 'Normal Image URL')}
                activeOpacity={0.7}
              >
                <View style={styles.postRowLeft}>
                  <Text style={[styles.normalLabel, viewQuality === 'preview' && styles.activeModeLabel]}>
                    Normal ({normalExt})
                  </Text>
                  <Text style={styles.postRowSubtitle}>
                    {sampleWidth}px X {sampleHeight}px
                  </Text>
                </View>
                <View style={[styles.yellowInfoBadge, viewQuality === 'preview' && styles.yellowInfoBadgeActive]}>
                  <InfoIcon size={13} color={viewQuality === 'preview' ? '#111216' : GOLD_ACCENT} />
                </View>
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Original (png/jpg/mp4) — tap for in-app full preview, yellow highlight when active */}
              <TouchableOpacity
                style={styles.postRowItem}
                onPress={handlePreviewOriginal}
                activeOpacity={0.7}
              >
                <View style={styles.postRowLeft}>
                  <Text style={[styles.originalLabel, viewQuality === 'full' && styles.activeModeLabel]}>
                    Original ({originalExt})
                  </Text>
                  <Text style={styles.postRowSubtitle}>
                    {resolvedDims
                      ? `${resolvedDims.w}px X ${resolvedDims.h}px`
                      : `${post.width}px X ${post.height}px`}
                    {formatBytes(resolvedBytes ?? post.fileSize) ? ` • ${formatBytes(resolvedBytes ?? post.fileSize)}` : ''}
                  </Text>
                </View>
                <View style={[styles.yellowInfoBadge, viewQuality === 'full' && styles.yellowInfoBadgeActive]}>
                  <InfoIcon size={13} color={viewQuality === 'full' ? '#111216' : GOLD_ACCENT} />
                </View>
              </TouchableOpacity>

              <View style={styles.rowDivider} />

              {/* Source Link */}
              <TouchableOpacity
                style={styles.postRowItem}
                onPress={() => {
                  if (post.sourceLink) handleOpenUrl(post.sourceLink);
                  else showToast('Source link not available');
                }}
                activeOpacity={0.7}
              >
                <View style={styles.postRowLeft}>
                  <Text style={styles.fieldLabel}>Source</Text>
                  <Text style={styles.postRowSubtitle} numberOfLines={1}>
                    {post.sourceLink || 'Unknown / None'}
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
                onPress={() => handleCopyText(post.originalUrl || post.sampleUrl, 'Image URL')}
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
                const color = getTagColor(item.category, item.name);
                return (
                  <React.Fragment key={`info-tag-${item.name}-${idx}`}>
                    {idx > 0 && <View style={styles.rowDivider} />}
                    <TouchableOpacity
                      style={styles.tagRowItem}
                      onPress={() => handleTagSearch(item.name, item.category)}
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

          {/* 3. NICHES SECTION (RedGifs categories — tap searches that category) */}
          {post.niches && post.niches.length > 0 && (
            <View style={styles.sectionContainer}>
              <Text style={styles.sectionTitle}>Niches</Text>

              <View style={styles.sectionBody}>
                {post.niches.map((nicheId, idx) => (
                  <React.Fragment key={`info-niche-${nicheId}-${idx}`}>
                    {idx > 0 && <View style={styles.rowDivider} />}
                    <TouchableOpacity
                      style={styles.tagRowItem}
                      onPress={() => handleTagSearch(`niche:${nicheId}`)}
                      onLongPress={(e) => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        handleOpenTagMenu({ name: `niche:${nicheId}`, category: 'general' }, e);
                      }}
                      delayLongPress={300}
                      activeOpacity={0.6}
                    >
                      <Text style={[styles.tagNameText, { color: '#F5A623' }]} numberOfLines={1}>
                        {nicheId.replace(/-/g, ' ')}
                      </Text>

                      <TouchableOpacity
                        style={styles.yellowDotsBadge}
                        onPress={(e) => handleOpenTagMenu({ name: `niche:${nicheId}`, category: 'general' }, e)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        activeOpacity={0.7}
                      >
                        <View style={styles.dot} />
                        <View style={styles.dot} />
                        <View style={styles.dot} />
                      </TouchableOpacity>
                    </TouchableOpacity>
                  </React.Fragment>
                ))}
              </View>
            </View>
          )}

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
            </View>
          </View>
        </ScrollView>

        {/* 4. FLOATING TAG CONTEXT MENU (In-View Overlay - No nested Modal) */}
        {selectedTag !== null && (
          <TouchableWithoutFeedback onPress={() => setSelectedTag(null)}>
            <View style={styles.modalOverlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.anchoredMenuCard, { top: menuTop, right: insetRight + 16 }]}>
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
                      onPress={() => handleTagSearch(selectedTag.name, selectedTag.category)}
                      activeOpacity={0.7}
                    >
                      <Search size={16} color="#E6EDF3" />
                      <Text style={styles.menuItemText}>Search</Text>
                    </TouchableOpacity>

                    {/* 2. Add to Search */}
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => handleTagAddToSearch(selectedTag.name, selectedTag.category)}
                      activeOpacity={0.7}
                    >
                      <PlusCircle size={16} color="#E6EDF3" />
                      <Text style={styles.menuItemText}>Add to Search</Text>
                    </TouchableOpacity>

                    {/* 3. Exclude from Search */}
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => handleTagExcludeFromSearch(selectedTag.name, selectedTag.category)}
                      activeOpacity={0.7}
                    >
                      <MinusCircle size={16} color="#E6EDF3" />
                      <Text style={styles.menuItemText}>Exclude from Search</Text>
                    </TouchableOpacity>

                    {/* 4. Copy */}
                    <TouchableOpacity
                      style={styles.menuItem}
                      onPress={() => {
                        handleCopyText(selectedTag.name, 'Tag');
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
        </Animated.View>
    </View>
  );

  if (!useModal) {
    return sheetContent;
  }

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={requestClose}
    >
      {sheetContent}
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdropContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  inlineOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 1100,
    elevation: 1100,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
  },
  sheet: {
    backgroundColor: 'rgba(20, 21, 24, 0.9)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  dragHandleContainer: {
    width: '100%',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 6,
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
    color: '#FFFFFF',
    marginBottom: 2,
  },
  originalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  /** Row of the active quality mode in the viewer (Normal/Original) */
  activeModeLabel: {
    color: GOLD_ACCENT,
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
  yellowInfoBadgeActive: {
    backgroundColor: GOLD_ACCENT,
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
