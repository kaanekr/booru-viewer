import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Dimensions,
  FlatList,
  Linking,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
  type ViewInstance,
} from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useEvent, useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { proxyService } from '../services/proxyService';
import * as Haptics from 'expo-haptics';
import {
  Heart,
  ChevronLeft,
  Info,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  AlertCircle,
  ExternalLink,
  Smartphone,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BooruPost } from '../types/booru';
import { Colors } from '../theme/colors';
import { StorageService, ImageQuality } from '../services/storage';
import { getPostKey } from '../utils/postIdentity';
import { isGifMediaPost } from '../utils/gifMedia';
import { downloadVideoViaAppSession } from '../utils/videoFallbackCache';
import { TagChip } from './TagChip';
import { PostInfoModal } from './PostInfoModal';
import { PornhubWebViewResolver } from './PornhubWebViewResolver';
import {
  checkMp4UpgradeAvailable,
  getImageUris,
  getMediaHeaders,
  getMediaUrl,
  getVideoCandidates,
  isUnsupportedOnIOS,
  isImageMediaUrl,
  isVideoPost,
  resolveGelbooruOriginalUrl,
  resolveRealbooruVideoUrls,
  selectRealbooruPlayable,
  resolveRealDimensions,
  resolveXVideosVideoUrls,
  resolveXHamsterVideoUrls,
  resolvePornhubVideoUrls,
  selectPrimaryVideoCandidate,
} from '../utils/media';
import { resolveSexComVideoUrls, selectSexComPlayable } from '../services/sexcom';
import { resolveHentaiHavenEpisodeUrls, listHentaiHavenEpisodes, resolveHentaiHavenEpisodeUrl, HentaiHavenEpisode } from '../services/hentaihavens';
import { resolveNHentaiPages, resolveNHentaiGalleryDetail, rotateNhentaiImageHost } from '../services/nhentai';

const { width: DEFAULT_SCREEN_WIDTH, height: DEFAULT_SCREEN_HEIGHT } = Dimensions.get('window');
const GOLD_ACCENT = '#F5A623';
const viewerKeyExtractor = (item: BooruPost, index: number) => `${getPostKey(item)}-${index}`;

/** '1.2 / 4.5 MB' text from bytes + total */
function formatMediaBytes(loaded: number, total: number): string {
  const fmt = (b: number) =>
    b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
  if (!total || total <= 0) return fmt(loaded);
  return `${fmt(loaded)} / ${fmt(total)}`;
}

interface ImageViewerModalProps {
  posts: BooruPost[];
  initialIndex: number;
  visible: boolean;
  onClose: (immediate?: boolean) => void;
  onTagPress: (tag: string) => void;
  onAddTagToSearch?: (tag: string) => void;
  onExcludeTagFromSearch?: (tag: string) => void;
  /** When 'none', no slide-in animation plays on open (used when going back). */
  enterAnimation?: 'slide' | 'none';
  /** When rendered as a stack route: no Modal wrapper, open/close and
      edge-swipe are left to the native stack. */
  asScreen?: boolean;
  suspended?: boolean;
  dismissOnTagPress?: boolean;
  onIndexChange?: (index: number) => void;
  /** Video timeline scrub state is reported up (for the back-gesture lock). */
  onScrubbingChange?: (isScrubbing: boolean) => void;
}

export const ImageViewerModal: React.FC<ImageViewerModalProps> = ({
  posts,
  initialIndex,
  visible,
  onClose,
  onTagPress,
  onAddTagToSearch,
  onExcludeTagFromSearch,
  enterAnimation = 'slide',
  asScreen = false,
  suspended = false,
  dismissOnTagPress = true,
  onIndexChange,
  onScrubbingChange,
}) => {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const insets = useSafeAreaInsets();
  const insetTop = insets.top ?? 0;
  const insetBottom = insets.bottom ?? 0;
  const insetLeft = insets.left ?? 0;
  const insetRight = insets.right ?? 0;
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const postsLengthRef = useRef(posts.length);
  postsLengthRef.current = posts.length;
  const [showControls, setShowControls] = useState(true);
  const [isPlayingSlideshow, setIsPlayingSlideshow] = useState(false);
  const [isFav, setIsFav] = useState(false);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const favoriteWriteRef = useRef(false);
  const favoriteRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const [showPageJump, setShowPageJump] = useState(false);
  const [pageInput, setPageInput] = useState('');
  const [showDetailsSheet, setShowDetailsSheet] = useState(false);
  const [isPeekingDetails, setIsPeekingDetails] = useState(false);
  const isPeekingDetailsRef = useRef(false);
  const sheetMaxHeight = Math.round(windowHeight * 0.92);
  const sheetMaxHeightRef = useRef(sheetMaxHeight);
  sheetMaxHeightRef.current = sheetMaxHeight;
  const edgeStartDxRef = useRef<number | null>(null);
  const [, setGalleryScrollFallback] = useState(true);
  const galleryScrollEnabledRef = useRef(true);
  // One-shot full-preview request from the Original row in the info modal
  const [previewOriginalId, setPreviewOriginalId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Animated slide value for interactive edge swipe back
  // Starts at 0 with asScreen: no off-screen flash on the first frame.
  const translateX = useRef(new Animated.Value(asScreen ? 0 : DEFAULT_SCREEN_WIDTH)).current;
  const infoSheetTranslateY = useRef(
    new Animated.Value(Math.round(DEFAULT_SCREEN_HEIGHT * 0.92))
  ).current;

  useEffect(() => {
    // Free mode is only granted while the media viewer is open
    return () => {
      if (Platform.OS !== 'web') {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
      }
    };
  }, []);

  // Synchronous native lock: once scrub/zoom starts, the horizontal pager
  // can grab the finger natively and swipe the page before a React state update
  // crosses the bridge. Update native scrollEnabled directly without forcing a
  // simultaneous JS re-render; only fall back to React state if setNativeProps
  // is unavailable (e.g. web/mocks).
  const setGalleryScrollSynchronously = useCallback((enabled: boolean) => {
    if (galleryScrollEnabledRef.current === enabled) return;
    galleryScrollEnabledRef.current = enabled;
    let updatedNatively = false;
    try {
      const list: any = flatListRef.current as any;
      const nativeRef = list?.getNativeScrollRef?.() ?? list;
      if (typeof nativeRef?.setNativeProps === 'function') {
        nativeRef.setNativeProps({ scrollEnabled: enabled });
        updatedNatively = true;
      }
    } catch {}
    if (!updatedNatively) {
      setGalleryScrollFallback(enabled);
    }
  }, []);

  useEffect(() => {
    onIndexChange?.(currentIndex);
    // Reset the scroll lock on page change: a page unmounting mid
    // zoom/scrub could leave the lock stuck on.
    setGalleryScrollSynchronously(true);
  }, [currentIndex, onIndexChange, setGalleryScrollSynchronously]);

  // On rotation the page width changes — snap back to the active page
  useEffect(() => {
    flatListRef.current?.scrollToOffset({
      offset: currentIndex * windowWidth,
      animated: false,
    });
  }, [windowWidth]);

  useEffect(() => {
    if (suspended || !visible) {
      setIsPlayingSlideshow(false);
      setShowDetailsSheet(false);
      setIsPeekingDetails(false);
      isPeekingDetailsRef.current = false;
      infoSheetTranslateY.setValue(sheetMaxHeightRef.current);
      setShowPageJump(false);
    } else if (visible) {
      // Bring controls back on refocus: resets the "controls are gone"
      // state where taps were swallowed.
      setShowControls(true);
    }
  }, [suspended, visible, infoSheetTranslateY]);

  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      setShowControls(true);
      setShowDetailsSheet(false);
      setIsPeekingDetails(false);
      isPeekingDetailsRef.current = false;
      infoSheetTranslateY.setValue(sheetMaxHeightRef.current);
      setIsPlayingSlideshow(false);
      setGalleryScrollSynchronously(true);
      setPreviewOriginalId(null);

      // Stack route and modal alike start at rest position.
      translateX.setValue(0);
    }
  }, [visible, initialIndex, enterAnimation, asScreen, setGalleryScrollSynchronously, translateX, infoSheetTranslateY]);

  const currentPost = posts[currentIndex] || posts[0];
  const currentPostKey = currentPost ? getPostKey(currentPost) : '';
  const currentPostKeyRef = useRef(currentPostKey);
  currentPostKeyRef.current = currentPostKey;

  useEffect(() => {
    if (!visible || suspended || !showPageJump) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setShowPageJump(false);
      return true;
    });
    return () => subscription.remove();
  }, [visible, suspended, showPageJump]);

  useEffect(() => {
    const request = ++favoriteRequestRef.current;
    setIsFav(false);
    if (currentPost && visible && !suspended) {
      StorageService.isFavorite(currentPost).then((value) => {
        if (favoriteRequestRef.current === request) setIsFav(value);
      });
    }
    return () => { favoriteRequestRef.current++; };
  }, [currentPostKey, visible, suspended]);

  useEffect(() => {
    // Prefetch next 2 and previous 1 images with sample resolution into disk cache to avoid OOM
    // Background (suspended) screens don't prefetch: overlapping
    // requests were locking the JS thread and delaying controls.
    if (visible && !suspended && posts.length > 0) {
      const neighbors = [
        posts[currentIndex + 1],
        posts[currentIndex + 2],
        posts[currentIndex - 1],
      ].filter(Boolean);

      neighbors.forEach((p) => {
        const rawUrl = p.sampleUrl || p.previewUrl;
        if (!isImageMediaUrl(rawUrl)) return;
        const url = getMediaUrl(rawUrl);
        if (url) {
          Image.prefetch(url, {
            headers: getMediaHeaders(url),
            cachePolicy: 'disk',
          }).catch(() => {});
        }
      });
    }
  }, [currentPost, currentIndex, visible, suspended, posts]);

  // Slideshow timer
  useEffect(() => {
    if (!isPlayingSlideshow || !visible || suspended || showDetailsSheet || showPageJump) return;
    const timer = setInterval(() => {
      const next = currentIndex + 1;
      if (next >= posts.length) {
        setIsPlayingSlideshow(false);
        return;
      }
      flatListRef.current?.scrollToIndex({ index: next, animated: true });
      setCurrentIndex(next);
    }, 3500);
    return () => clearInterval(timer);
  }, [isPlayingSlideshow, currentIndex, posts.length, visible, suspended, showDetailsSheet, showPageJump]);

  // In stack-route mode the native stack is in charge: its own open animation
  // and edge-swipe gesture are off; translateX stays pinned at 0.
  const isStackScreen = asScreen === true;
  const handleDismissWithSlide = useCallback((immediate?: boolean) => {
    if (immediate) {
      onClose(true);
      return;
    }
    Haptics.selectionAsync();
    if (isStackScreen) {
      onClose();
      return;
    }
    Animated.timing(translateX, {
      toValue: windowWidth,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  }, [isStackScreen, onClose, translateX, windowWidth]);

  // Interactive edge swipe gesture (modal mode, Android, and asScreen video pages):
  // tracks finger horizontal translation 1:1 from 0px without stealing taps,
  // and completes the slide off-screen before calling onClose(true) so there is
  // never a snap-back or double slide animation.
  const edgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          gesture.dx > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.15,
        onPanResponderGrant: (_, gesture) => {
          edgeStartDxRef.current = gesture?.dx ?? 0;
          (translateX as any).stopAnimation?.();
        },
        onPanResponderMove: (_, gesture) => {
          const deltaX = gesture.dx - (edgeStartDxRef.current ?? 0);
          translateX.setValue(deltaX > 0 ? deltaX : 0);
        },
        onPanResponderRelease: (_, gesture) => {
          const startDx = edgeStartDxRef.current ?? 0;
          edgeStartDxRef.current = null;
          const deltaX = gesture.dx - startDx;
          if (deltaX > 72 || gesture.vx > 0.35) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Animated.timing(translateX, {
              toValue: windowWidth,
              duration: 130,
              useNativeDriver: true,
            }).start(() => {
              onClose(true);
            });
          } else {
            Animated.spring(translateX, {
              toValue: 0,
              damping: 26,
              stiffness: 300,
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          edgeStartDxRef.current = null;
          Animated.spring(translateX, {
            toValue: 0,
            damping: 26,
            stiffness: 300,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminationRequest: () => false,
      }),
    [translateX, onClose, windowWidth]
  );

  const handleToggleControls = useCallback(() => {
    setShowControls((prev) => !prev);
  }, []);

  const handleToggleFav = async () => {
    if (!currentPost || favoriteWriteRef.current) return;
    favoriteWriteRef.current = true;
    favoriteRequestRef.current++;
    const key = currentPostKey;
    setSavingFavorite(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const newStatus = await StorageService.toggleFavorite(currentPost);
      if (mountedRef.current && currentPostKeyRef.current === key) setIsFav(newStatus);
    } catch {
      if (mountedRef.current) Alert.alert('Could not save favorite', 'Your saved posts have not been changed. Please try again.');
    } finally {
      favoriteWriteRef.current = false;
      if (mountedRef.current) setSavingFavorite(false);
    }
  };

  const toggleDetails = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowDetailsSheet((prev) => {
      if (!prev) {
        infoSheetTranslateY.setValue(sheetMaxHeightRef.current);
      }
      return !prev;
    });
  };

  const toggleOrientation = async () => {
    if (Platform.OS === 'web') return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const current = await ScreenOrientation.getOrientationAsync();
      const isLandscapeCurrent =
        current === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
        current === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
      if (isLandscapeCurrent) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
      }
    } catch {}
  };

  const toggleSlideshow = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!isPlayingSlideshow && currentIndex === posts.length - 1) {
      setCurrentIndex(0);
      flatListRef.current?.scrollToIndex({ index: 0, animated: true });
    }
    setIsPlayingSlideshow((prev) => !prev);
  };

  const jumpToPage = () => {
    const page = Number(pageInput);
    if (!/^\d+$/.test(pageInput.trim()) || !Number.isSafeInteger(page) || page < 1 || page > posts.length) {
      Alert.alert('Invalid page', `Enter a page from 1 to ${posts.length}.`);
      return;
    }
    setCurrentIndex(page - 1);
    flatListRef.current?.scrollToIndex({ index: page - 1, animated: false });
    setShowPageJump(false);
  };

  const handleZoomChange = useCallback(
    (isZoomed: boolean) => {
      setGalleryScrollSynchronously(!isZoomed);
    },
    [setGalleryScrollSynchronously]
  );
  const handleScrubbingChange = useCallback(
    (isScrubbing: boolean) => {
      setGalleryScrollSynchronously(!isScrubbing);
      onScrubbingChange?.(isScrubbing);
    },
    [setGalleryScrollSynchronously, onScrubbingChange]
  );
  const handleOpenDetails = useCallback(() => {
    infoSheetTranslateY.setValue(sheetMaxHeightRef.current);
    setShowDetailsSheet(true);
  }, [infoSheetTranslateY]);
  const handleInfoDragStart = useCallback(() => {
    (infoSheetTranslateY as any).stopAnimation?.();
    if (!isPeekingDetailsRef.current) {
      isPeekingDetailsRef.current = true;
      setIsPeekingDetails(true);
    }
  }, [infoSheetTranslateY]);
  const handleInfoDragMove = useCallback(
    (dy: number) => {
      if (dy < 0) {
        if (!isPeekingDetailsRef.current) {
          isPeekingDetailsRef.current = true;
          setIsPeekingDetails(true);
        }
        infoSheetTranslateY.setValue(Math.max(0, sheetMaxHeightRef.current + dy * 1.15));
      } else if (isPeekingDetailsRef.current) {
        infoSheetTranslateY.setValue(sheetMaxHeightRef.current);
      }
    },
    [infoSheetTranslateY]
  );
  const handleInfoDragEnd = useCallback(
    (shouldOpen: boolean) => {
      if (shouldOpen) {
        isPeekingDetailsRef.current = false;
        setIsPeekingDetails(false);
        setShowDetailsSheet(true);
        return;
      }
      if (!isPeekingDetailsRef.current) return;
      Animated.spring(infoSheetTranslateY, {
        toValue: sheetMaxHeightRef.current,
        damping: 28,
        stiffness: 320,
        useNativeDriver: true,
      }).start(() => {
        isPeekingDetailsRef.current = false;
        if (mountedRef.current) {
          setIsPeekingDetails(false);
        }
      });
    },
    [infoSheetTranslateY]
  );
  const handleTagsResolved = useCallback(
    (
      targetPost: BooruPost,
      tags: BooruPost['tags'],
      allTags: string[],
      numFavorites?: number
    ) => {
      targetPost.tags = tags;
      targetPost.allTags = allTags;
      // Score = favorite count: absent from list HTML, arrives with detail
      if (numFavorites) {
        targetPost.score = numFavorites;
        targetPost.favCount = numFavorites;
      }
    },
    []
  );
  const getItemLayout = useCallback(
    (_: ArrayLike<BooruPost> | null | undefined, index: number) => ({
      length: windowWidth,
      offset: windowWidth * index,
      index,
    }),
    [windowWidth]
  );
  const handleMomentumScrollEnd = useCallback(
    (e: any) => {
      const newIndex = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
      if (newIndex !== currentIndexRef.current && newIndex >= 0 && newIndex < postsLengthRef.current) {
        setCurrentIndex(newIndex);
      }
    },
    [windowWidth]
  );
  const renderPostPageItem = useCallback(
    ({ item, index }: { item: BooruPost; index: number }) => (
      <PostPageItem
        post={item}
        isActive={index === currentIndex}
        suspended={suspended || showPageJump}
        forceFull={previewOriginalId === getPostKey(item)}
        onTagsResolved={handleTagsResolved}
        showControls={index === currentIndex ? showControls : false}
        screenWidth={windowWidth}
        screenHeight={windowHeight}
        onToggleControls={handleToggleControls}
        onSetControlsVisible={setShowControls}
        onOpenDetails={handleOpenDetails}
        onInfoDragStart={handleInfoDragStart}
        onInfoDragMove={handleInfoDragMove}
        onInfoDragEnd={handleInfoDragEnd}
        onClose={handleDismissWithSlide}
        onTagPress={onTagPress}
        onZoomChange={handleZoomChange}
        onScrubbingChange={handleScrubbingChange}
      />
    ),
    [
      currentIndex,
      suspended,
      showPageJump,
      previewOriginalId,
      showControls,
      windowWidth,
      windowHeight,
      handleTagsResolved,
      handleToggleControls,
      handleOpenDetails,
      handleInfoDragStart,
      handleInfoDragMove,
      handleInfoDragEnd,
      handleDismissWithSlide,
      onTagPress,
      handleZoomChange,
      handleScrubbingChange,
    ]
  );

  // Keep every hook above the visibility guard: modal open/close must not
  // change the number of hooks called by this mounted component.
  if (!visible || !posts || posts.length === 0) return null;

  const viewerBody = (
    <View style={asScreen ? styles.container : styles.modalBackdrop}>
        {/* Animated Container */}
        <Animated.View
          style={[
            styles.container,
            {
              transform: [{ translateX }],
            },
          ]}
        >
          {/* Left-edge back area: active in modal mode and on Android (where
              native stack swipe-back doesn't exist). On iOS asScreen, native
              stack handles both photos and videos identically. */}
          {(!asScreen || Platform.OS === 'android') && (
            <View
              style={[
                styles.leftEdgeGestureArea,
                {
                  width: 44 + Math.min(insetLeft, 32),
                  bottom: 150 + insetBottom,
                },
              ]}
              {...edgePanResponder.panHandlers}
            />
          )}

          {/* 1. HORIZONTAL MEDIA PAGER */}
          <FlatList
            ref={flatListRef}
            data={posts}
            keyExtractor={viewerKeyExtractor}
            horizontal
            pagingEnabled
            scrollEnabled={galleryScrollEnabledRef.current}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(initialIndex, posts.length - 1)}
            windowSize={3}
            maxToRenderPerBatch={1}
            initialNumToRender={1}
            removeClippedSubviews
            getItemLayout={getItemLayout}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            renderItem={renderPostPageItem}
          />

          {/* 2. TOP FLOATING BAR */}
          {showControls && (
            <View
              style={[
                styles.topBar,
                {
                  top: Math.max(insetTop, 16),
                  left: Math.max(insetLeft + 8, 16),
                  right: Math.max(insetRight + 8, 16),
                },
              ]}
            >
              <TouchableOpacity
                style={styles.circleBtn}
                onPress={() => handleDismissWithSlide()}
                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                activeOpacity={0.7}
              >
                <ChevronLeft size={24} color="#FFFFFF" />
              </TouchableOpacity>

              {/* Source & Position Badge */}
              <TouchableOpacity
                style={styles.sourceBadge}
                accessibilityLabel="Jump to post"
                onPress={() => { setPageInput(String(currentIndex + 1)); setShowPageJump(true); }}
              >
                <Text style={styles.sourceText} numberOfLines={1}>
                  {currentPost?.sourceName || 'Booru'}
                </Text>
                <Text style={styles.pageCountText}>
                  {currentIndex + 1} / {posts.length}
                </Text>
              </TouchableOpacity>

              {/* Top Right Info Button */}
              <TouchableOpacity
                style={[styles.circleBtn, showDetailsSheet && styles.circleBtnActive]}
                onPress={toggleDetails}
                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                activeOpacity={0.7}
              >
                <Info size={22} color={showDetailsSheet ? GOLD_ACCENT : '#FFFFFF'} />
              </TouchableOpacity>
            </View>
          )}

          {/* 3. BOTTOM ACTION BAR (Left: Orientation, Right: Heart) */}
          {showControls && (
            <View
              style={[
                styles.bottomActionBar,
                {
                  bottom: Math.max(insetBottom, 20),
                  left: Math.max(insetLeft + 8, 20),
                  right: Math.max(insetRight + 8, 20),
                },
              ]}
            >
              {/* Left Orientation Button */}
              <TouchableOpacity
                style={styles.circleBtn}
                onPress={toggleOrientation}
                activeOpacity={0.7}
                accessibilityLabel="Yatay/Dikey mod"
              >
                <Smartphone
                  size={22}
                  color="#FFFFFF"
                  style={isLandscape ? { transform: [{ rotate: '90deg' }] } : undefined}
                />
              </TouchableOpacity>

              {/* Right Heart '♡' Button */}
              <TouchableOpacity
                style={styles.circleBtn}
                onPress={toggleSlideshow}
                disabled={posts.length < 2}
                accessibilityLabel={isPlayingSlideshow ? 'Stop slideshow' : 'Start slideshow'}
              >
                {isPlayingSlideshow ? <Pause size={22} color={GOLD_ACCENT} /> : <Play size={22} color="#FFFFFF" />}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.circleBtn, isFav && styles.circleBtnFavActive]}
                onPress={handleToggleFav}
                disabled={savingFavorite}
                accessibilityLabel={isFav ? 'Remove favorite' : 'Save favorite'}
                activeOpacity={0.7}
              >
                <Heart
                  size={22}
                  color={isFav ? '#FF4D4F' : '#FFFFFF'}
                  fill={isFav ? '#FF4D4F' : 'transparent'}
                />
              </TouchableOpacity>
            </View>
          )}

          {/* 4. POST INFO SHEET (Inline 1:1 interactive layer — no Modal mount lag) */}
          <PostInfoModal
            useModal={false}
            visible={showDetailsSheet && !suspended}
            isPeeking={isPeekingDetails && !suspended}
            externalTranslateY={infoSheetTranslateY}
            post={currentPost}
            onClose={() => {
              setShowDetailsSheet(false);
              isPeekingDetailsRef.current = false;
              setIsPeekingDetails(false);
            }}
            onPreviewOriginal={(p) => setPreviewOriginalId(getPostKey(p))}
            onSearchTag={(tag) => {
              setShowDetailsSheet(false);
              if (!asScreen && dismissOnTagPress) {
                onClose();
              }
              onTagPress(tag);
            }}
            onAddTagToSearch={(tag) => {
              setShowDetailsSheet(false);
              if (!asScreen && dismissOnTagPress) {
                onClose();
              }
              if (onAddTagToSearch) {
                onAddTagToSearch(tag);
              } else {
                onTagPress(tag);
              }
            }}
            onExcludeTagFromSearch={(tag) => {
              setShowDetailsSheet(false);
              if (!asScreen && dismissOnTagPress) {
                onClose();
              }
              if (onExcludeTagFromSearch) {
                onExcludeTagFromSearch(tag);
              } else {
                onTagPress(`-${tag}`);
              }
            }}
          />
          {showPageJump && (
            <View style={styles.jumpOverlay}>
              <View style={styles.jumpPanel} accessibilityViewIsModal>
                <Text style={styles.jumpTitle}>Jump to post (1–{posts.length})</Text>
                <TextInput
                  style={styles.jumpInput}
                  value={pageInput}
                  onChangeText={setPageInput}
                  keyboardType="number-pad"
                  returnKeyType="go"
                  onSubmitEditing={jumpToPage}
                  accessibilityLabel="Post number"
                  autoFocus
                  maxLength={String(posts.length).length}
                />
                <View style={styles.jumpActions}>
                  <TouchableOpacity onPress={() => setShowPageJump(false)} accessibilityLabel="Cancel jump">
                    <Text style={styles.jumpAction}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={jumpToPage} accessibilityLabel="Go to post">
                    <Text style={styles.jumpAction}>Go</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </Animated.View>
      </View>
  );

  if (asScreen) {
    return viewerBody;
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={() => showPageJump ? setShowPageJump(false) : handleDismissWithSlide()}
    >
      {viewerBody}
    </Modal>
  );
};

/**
 * Single manga page image: on error it moves to the next CDN host
 * (i3->i2->i4->i1; some networks block individual hosts). expo-image hangs
 * without onError on a stuck connection; a 15s stall-guard triggers the same
 * rotation. An unloadable page shows an info text instead of an empty black square.
 */
const MangaPageImage: React.FC<{
  uri: string;
  pageIndex: number;
  pageLabel: string;
  width: number;
  defaultHeight: number;
  onMeasuredHeight?: (index: number, height: number) => void;
}> = React.memo(({ uri, pageIndex, pageLabel, width, defaultHeight, onMeasuredHeight }) => {
  const [src, setSrc] = React.useState(uri);
  const [failed, setFailed] = React.useState(false);
  const [naturalAspect, setNaturalAspect] = React.useState<number | null>(null);
  const srcRef = React.useRef(src);
  srcRef.current = src;
  const loadedRef = React.useRef(false);
  React.useEffect(() => {
    setSrc(uri);
    setFailed(false);
    setNaturalAspect(null);
    loadedRef.current = false;
  }, [uri]);
  const height = naturalAspect ? Math.round(width / naturalAspect) : defaultHeight;
  const advance = React.useCallback(() => {
    const next = rotateNhentaiImageHost(srcRef.current);
    if (next) {
      loadedRef.current = false;
      setSrc(next);
    } else {
      setFailed(true);
    }
  }, []);
  // Stall-guard: switch hosts when neither onLoad nor onError fires. Kept SHORT
  // (4s): try the next host immediately instead of waiting on a dead one;
  // errors already switch instantly (onError). No early switch on a slow but
  // working host because onLoad arrives before the 4s elapse.
  React.useEffect(() => {
    if (failed) return;
    const t = setTimeout(() => {
      if (!loadedRef.current) advance();
    }, 4000);
    return () => clearTimeout(t);
  }, [src, failed, advance]);
  return (
    <View
      style={{
        width,
        height,
        backgroundColor: '#000000',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {!failed ? (
        <Image
          source={{
            uri: getMediaUrl(src) || src,
            headers: getMediaHeaders(src),
            cacheKey: `${src}:manga-page`,
          }}
          style={{ width, height }}
          contentFit="contain"
          contentPosition="center"
          cachePolicy="memory-disk"
          transition={150}
          onLoad={(e: any) => {
            loadedRef.current = true;
            const imgW = e?.source?.width;
            const imgH = e?.source?.height;
            if (typeof imgW === 'number' && typeof imgH === 'number' && imgW > 0 && imgH > 0) {
              const aspect = imgW / imgH;
              if (aspect > 0.15 && aspect < 6) {
                const measuredH = Math.round(width / aspect);
                setNaturalAspect(aspect);
                onMeasuredHeight?.(pageIndex, measuredH);
              }
            }
          }}
          onError={advance}
        />
      ) : (
        <Text style={{ color: '#666666', fontSize: 13 }}>
          {`Page ${pageLabel} could not be loaded`}
        </Text>
      )}
    </View>
  );
});

interface PostPageItemProps {
  post: BooruPost;
  isActive: boolean;
  suspended?: boolean;
  /** One-shot full preview from the Original row in the info modal */
  forceFull?: boolean;
  showControls?: boolean;
  screenWidth: number;
  screenHeight: number;
  onTagsResolved?: (
    post: BooruPost,
    tags: BooruPost['tags'],
    allTags: string[],
    numFavorites?: number
  ) => void;
  onToggleControls: () => void;
  onSetControlsVisible?: (visible: boolean) => void;
  onOpenDetails: () => void;
  onInfoDragStart?: () => void;
  onInfoDragMove?: (dy: number) => void;
  onInfoDragEnd?: (shouldOpen: boolean) => void;
  onClose: (immediate?: boolean) => void;
  onTagPress: (tag: string) => void;
  onZoomChange?: (isZoomed: boolean) => void;
  onScrubbingChange?: (isScrubbing: boolean) => void;
}

const PostPageItem: React.FC<PostPageItemProps> = React.memo(({
  post,
  isActive,
  suspended = false,
  forceFull = false,
  showControls = true,
  screenWidth,
  screenHeight,
  onTagsResolved,
  onToggleControls,
  onSetControlsVisible,
  onOpenDetails,
  onInfoDragStart,
  onInfoDragMove,
  onInfoDragEnd,
  onClose,
  onZoomChange,
  onScrubbingChange,
}) => {
  const insets = useSafeAreaInsets();
  const insetTop = insets.top ?? 0;
  const insetBottom = insets.bottom ?? 0;
  const insetLeft = insets.left ?? 0;
  const insetRight = insets.right ?? 0;
  const [sampleLoading, setSampleLoading] = useState(true);
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [fullLoading, setFullLoading] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false);
  const [fullProgress, setFullProgress] = useState<number | null>(null);
  const [fullLoadedBytes, setFullLoadedBytes] = useState(0);
  const [fullTotalBytes, setFullTotalBytes] = useState(0);
  // Animated GIF layer (Realbooru & co): the full file is many MB, so it loads
  // above the thumbnail cover and only fades in once a frame is ready.
  const [gifLoaded, setGifLoaded] = useState(false);
  const [gifFailed, setGifFailed] = useState(false);
  const [gifError, setGifError] = useState('');
  const [gifProgress, setGifProgress] = useState<number | null>(null);
  const [gifProxyAttempt, setGifProxyAttempt] = useState(false);
  const [isScrubbingActive, setIsScrubbingActive] = useState(false);
  const isScrubbingRef = useRef(false);
  const [upgradedMp4Url, setUpgradedMp4Url] = useState<string | null>(null);
  const [isCheckingUpgrade, setIsCheckingUpgrade] = useState(false);
  const [quality, setQuality] = useState<ImageQuality>('auto');
  const [resolvedOriginalUrl, setResolvedOriginalUrl] = useState<string | null>(null);
  // If resolving dies, "Retry" bumps this counter and re-runs the effect.
  const [resolveNonce, setResolveNonce] = useState(0);
  const [pornhubWebviewOn, setPornhubWebviewOn] = useState(false);
  const [videoResolveFailed, setVideoResolveFailed] = useState(false);
  const [realDims, setRealDims] = useState<{ w: number; h: number } | null>(null);
  // HentaiHaven: series card -> episode list + selected episode (EP picker).
  const [hhEpisodes, setHhEpisodes] = useState<HentaiHavenEpisode[]>([]);
  const [hhActiveEp, setHhActiveEp] = useState<number | null>(null);
  const [hhEpLoading, setHhEpLoading] = useState(false);
  const hhEpisodeRequestRef = useRef<AbortController | null>(null);
  const sortedHhEpisodes = useMemo(
    () => [...hhEpisodes].sort((a, b) => a.ep - b.ep),
    [hhEpisodes]
  );
  // nhentai: vertical-reader manga pages and the active page indicator
  const [mangaPages, setMangaPages] = useState<string[]>([]);
  const [mangaLoading, setMangaLoading] = useState(false);
  const [currentMangaPage, setCurrentMangaPage] = useState(1);
  const lastMangaPageRef = useRef(1);
  const mangaPageHeightsRef = useRef<Record<number, number>>({});
  const [isMangaZoomed, setIsMangaZoomed] = useState(false);
  const mangaScrollRef = useRef<ScrollViewInstance>(null);
  const isMangaZoomedRef = useRef(false);
  const mangaLastTapRef = useRef<number>(0);
  const mangaSingleTapTimerRef = useRef<any>(null);
  const mangaOffsetYRef = useRef<number>(0);
  const mangaZoomScaleRef = useRef<number>(1);
  const [isZoomed, setIsZoomed] = useState(false);
  const [hasUpgradedToFull, setHasUpgradedToFull] = useState(false);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const lastTapRef = useRef<number>(0);
  const isZoomedRef = useRef<boolean>(false);
  const dismissingRef = useRef<boolean>(false);
  const singleTapTimerRef = useRef<any>(null);
  const dragY = useRef(new Animated.Value(0)).current;
  const dragStartDyRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      if (mangaSingleTapTimerRef.current) {
        clearTimeout(mangaSingleTapTimerRef.current);
        mangaSingleTapTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isActive || suspended) return;
    let isMounted = true;
    StorageService.getImageQuality().then((q) => {
      if (isMounted) setQuality(q);
    }).catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [isActive, suspended]);

  useEffect(() => {
    let alive = true;
    const abortCtrl = new AbortController();

    setResolvedOriginalUrl(null);
    setPornhubWebviewOn(false);
    setVideoResolveFailed(false);

    // Neighbors retain their covers, but only the visible foreground page
    // resolves full media. Otherwise swiping fetches the same details twice.
    if (suspended || !isActive) {
      return () => {
        alive = false;
        abortCtrl.abort();
      };
    }

    // Skip the fetch when the post already owns a real originalUrl different from sample
    // Note: XHamster, XVideos, Sex.com and HentaiHaven always re-resolve fresh from detail
    // because they carry expiring tokens/temporary previews
    const needsFreshVideoResolution = post.sourceId === 'realbooru' || post.sourceId === 'xvideos' || post.sourceId === 'xhamster' || post.sourceId === 'sexcom' || post.sourceId === 'hentaihaven';
    if (post.originalUrl && post.originalUrl !== post.sampleUrl && !needsFreshVideoResolution) {
      setResolvedOriginalUrl(post.originalUrl);
      return () => {
        alive = false;
        abortCtrl.abort();
      };
    }

    // For Gelbooru/Realbooru/XVideos or scrape posts missing originalUrl,
    // resolve from the post detail (XVideos mp4s carry expiring tokens, resolve fresh)
    if (post.sourceLink) {
      if (post.sourceId === 'xvideos') {
        resolveXVideosVideoUrls(post, abortCtrl.signal)
          .then((files) => {
            if (alive && files) {
              setResolvedOriginalUrl(files.high || files.low || files.hls || null);
            }
          })
          .catch(() => {});
      } else if (post.sourceId === 'xhamster') {
        resolveXHamsterVideoUrls(post, abortCtrl.signal)
          .then((files) => {
            if (alive && files) {
              setResolvedOriginalUrl(files.high || files.low || files.hls || null);
            }
          })
          .catch(() => {});
      } else if (post.sourceId === 'sexcom') {
        resolveSexComVideoUrls(post, abortCtrl.signal)
          .then((files) => {
            if (!alive) return;
            if (files) {
              // Premium-locked HLS won't open in the anonymous player: quietly
              // fall back to the preview (better than an error card) but keep
              // the reason visible in Metro. Same for detail without HLS.
              if (files.premium) {
                console.warn('[Viewer] sexcom premium video, playing preview');
              } else if (!files.hls) {
                console.warn('[Viewer] sexcom full video not found, playing preview');
              }
              setResolvedOriginalUrl(selectSexComPlayable(files));
            } else {
              // Detail couldn't be fetched (both direct + worker failed): the viewer
              // stays on the card's preview. This line in Metro tells why.
              console.warn('[Viewer] sexcom detail not resolvable, playing preview');
            }
          })
          .catch(() => {});
      } else if (post.sourceId === 'hentaihaven') {
        StorageService.getLastWatchedEpisode(post.id)
          .then((savedEp) => {
            if (!alive) return;
            return resolveHentaiHavenEpisodeUrls(post, abortCtrl.signal, savedEp)
              .then(async (files) => {
                if (!alive) return;
                const eps = files?.episodes;
                if (eps && eps.length > 0) {
                  setHhEpisodes(eps);
                  const effectiveEp =
                    savedEp != null && eps.some((e) => e.ep === savedEp)
                      ? savedEp
                      : eps[0].ep;
                  setHhActiveEp(effectiveEp);
                  StorageService.setLastWatchedEpisode(post.id, effectiveEp).catch(() => {});
                }
                if (files?.tags) {
                  onTagsResolved?.(post, files.tags, files.allTags || [], files.views);
                }
                const playable = files?.hls || files?.mp4;
                if (playable) {
                  console.log('[Viewer] hentaihaven episode resolved, playing');
                  setResolvedOriginalUrl(playable);
                } else {
                  // Series/episode couldn't be fetched or there is no HLS: the cover photo stays.
                  console.warn('[Viewer] hentaihaven episode not resolvable, keeping cover');
                }
                // The primary response normally contains episodes. Only fetch
                // the backup after it completes without them, never in parallel.
                if (!eps?.length) {
                  const fallbackEpisodes = await listHentaiHavenEpisodes(post, abortCtrl.signal);
                  if (!alive || !fallbackEpisodes.length) return;
                  setHhEpisodes(fallbackEpisodes);
                  setHhActiveEp((current) => current ?? fallbackEpisodes[0].ep);
                }
              });
          })
          .catch(() => {});
      } else if (post.sourceId === 'pornhub') {
        resolvePornhubVideoUrls(post, abortCtrl.signal)
          .then((files) => {
            if (!alive) return;
            if (files) {
              setResolvedOriginalUrl(files.high || files.hls || files.low || null);
            } else {
              // Fast path hit the bot wall → hidden WebView fallback
              setPornhubWebviewOn(true);
            }
          })
          .catch(() => {});
      } else if (post.sourceId === 'realbooru') {
        // Listing tags carry no file extension (the scraper guesses .mp4),
        // so resolve the real mp4/webm/gif from the detail page.
        // GIFs land on the detail image and render as an animated image.
        resolveRealbooruVideoUrls(post, abortCtrl.signal)
          .then((files) => {
            if (!alive || !files) return;
            const playable = selectRealbooruPlayable(files);
            if (playable) setResolvedOriginalUrl(playable);
          })
          .catch(() => {});
      } else if (post.sourceId === 'gelbooru' || post.sourceId === 'realbooru' || !post.originalUrl) {
        resolveGelbooruOriginalUrl(post, abortCtrl.signal)
          .then((url) => {
            if (alive && url) {
              setResolvedOriginalUrl(url);
            }
          })
          .catch(() => {});
      }
    }

    return () => {
      alive = false;
      abortCtrl.abort();
    };
  }, [isActive, suspended, resolveNonce, post.id, post.sourceId, post.sourceLink, post.originalUrl, post.sampleUrl]);

  useEffect(() => {
    setHhEpLoading(false);
    return () => {
      hhEpisodeRequestRef.current?.abort();
      hhEpisodeRequestRef.current = null;
    };
  }, [isActive, suspended, post.id, post.sourceId, post.sourceLink]);

  const handleSelectHhEpisode = useCallback(
    (ep: HentaiHavenEpisode) => {
      if (!isActive || suspended || hhEpisodeRequestRef.current || ep.ep === hhActiveEp) return;
      const ctrl = new AbortController();
      hhEpisodeRequestRef.current = ctrl;
      const baseM = post.sourceLink?.match(/^https?:\/\/[^/]+/i);
      const base = baseM ? baseM[0] : 'https://hentaihaven.xxx';
      const targetUrl = ep.streamUrl || ep.url;
      const url = /^https?:\/\//i.test(targetUrl) ? targetUrl : base + targetUrl;
      setHhActiveEp(ep.ep);
      setHhEpLoading(true);
      setResolvedOriginalUrl(null);
      // Persist the last watched / selected episode to device memory (resumed here when opened from favorites).
      StorageService.setLastWatchedEpisode(post.id, ep.ep).catch(() => {});
      resolveHentaiHavenEpisodeUrl(url, ctrl.signal)
        .then((files) => {
          if (ctrl.signal.aborted || hhEpisodeRequestRef.current !== ctrl) return;
          const playable = files?.hls || files?.mp4;
          if (playable) {
            console.log('[Viewer] hentaihaven episode resolved, playing (EP ' + ep.ep + ')');
            setResolvedOriginalUrl(playable);
          } else {
            console.warn('[Viewer] hentaihaven episode not resolvable, keeping cover (EP ' + ep.ep + ')');
          }
        })
        .catch(() => {})
        .finally(() => {
          if (hhEpisodeRequestRef.current !== ctrl) return;
          hhEpisodeRequestRef.current = null;
          setHhEpLoading(false);
        });
    },
    [isActive, suspended, hhActiveEp, post.id, post.sourceLink]
  );

  // Fuse: if fetch + WebView exceed 30s total, kill the spinner and
  // show the Retry card. (A hung connection could leave every branch unterminated.)
  useEffect(() => {
    if (post.sourceId !== 'pornhub' || !isActive || suspended) return;
    if (resolvedOriginalUrl || videoResolveFailed) return;
    const t = setTimeout(() => {
      setPornhubWebviewOn(false);
      setVideoResolveFailed(true);
    }, 30000);
    return () => clearTimeout(t);
  }, [isActive, suspended, resolvedOriginalUrl, videoResolveFailed, post.sourceId, post.id]);

  useEffect(() => {
    setIsZoomed(false);
    isZoomedRef.current = false;
    setPornhubWebviewOn(false);
    setVideoResolveFailed(false);
    setResolveNonce(0);
    setHhEpisodes([]);
    setHhActiveEp(null);
    setHhEpLoading(false);
    setMangaPages([]);
    setCurrentMangaPage(1);
    lastMangaPageRef.current = 1;
    mangaPageHeightsRef.current = {};
    dismissingRef.current = false;
    dragY.setValue(0);
    setMangaLoading(false);
    setIsMangaZoomed(false);
    mangaOffsetYRef.current = 0;
    mangaZoomScaleRef.current = 1;
    setHasUpgradedToFull(false);
    setSampleLoading(true);
    setSampleLoaded(false);
    setFullLoading(false);
    setFullLoaded(false);
    setFullProgress(null);
    setFullLoadedBytes(0);
    setFullTotalBytes(0);
    setGifLoaded(false);
    setGifFailed(false);
  }, [post.id]);

  // Real resolution: for the zoom-ceiling computation (session-cached, one-shot).
  // Replaces the scrape placeholder (800x1000) with the real WxH from the post page.
  useEffect(() => {
    if (!isActive || suspended) return;
    // Video sites (PH/XV/XH) carry no size info on the watch page;
    // dimensions come from the list (PH 640x360). This fetch was half of the
    // double page download on video open — skipping it reduces stutter.
    if (post.sourceId === 'pornhub' || post.sourceId === 'xvideos' || post.sourceId === 'xhamster' || post.sourceId === 'sexcom' || post.sourceId === 'hentaihaven' || post.sourceId === 'nhentai') {
      return;
    }
    let alive = true;
    setRealDims(null);
    resolveRealDimensions(post)
      .then((d) => {
        if (alive && d) setRealDims({ w: d.w, h: d.h });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isActive, suspended, post.id, post.sourceLink, post.originalUrl, post.sampleUrl]);

  // nhentai: resolves all pages and tags of the manga album (for the vertical reader)
  useEffect(() => {
    if (post.sourceId !== 'nhentai' || !isActive || suspended) return;
    let alive = true;
    const ctrl = new AbortController();
    setMangaLoading(true);
    resolveNHentaiGalleryDetail(post, ctrl.signal)
      .then((detail) => {
        if (!alive) return;
        if (detail.pages && detail.pages.length > 0) {
          setMangaPages(detail.pages);
        } else {
          // No page list (API blocked/rate-limited and no mediaId+pageCount on the
          // post): show the first image we do have instead of an empty black reader.
          const firstImage = post.originalUrl || post.sampleUrl || post.previewUrl;
          console.warn('[nhentai] Gallery detail returned no pages:', post.id, firstImage);
          if (firstImage) setMangaPages([firstImage]);
        }
        // Forward detail-resolved categorized tags to the Info panel
        if (detail.allTags && detail.allTags.length > 0) {
          onTagsResolved?.(post, detail.tags, detail.allTags, detail.numFavorites);
        } else if (detail.numFavorites) {
          onTagsResolved?.(post, post.tags, post.allTags, detail.numFavorites);
        }
      })
      .catch((err) => {
        console.warn('[nhentai] Gallery detail resolution failed:', err);
        if (!alive) return;
        // Keep the reader usable: fall back to the post's own first image.
        const firstImage = post.originalUrl || post.sampleUrl || post.previewUrl;
        if (firstImage) setMangaPages([firstImage]);
      })
      .finally(() => {
        if (alive) setMangaLoading(false);
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [isActive, suspended, post.id, post.sourceId, post.sourceLink, post.mediaId, post.pageCount]);

  /**
   * Sharp zoom ceiling by resolution: the ratio matching 1:1 pixels in
   * contain-fit = max(imgW/screenW, imgH/screenH). No upper cap — the more
   * resolution, the more zoom. 2x floor (some zoom even on below-screen
   * images). NOTE: huge images + deep zoom pressure memory on iOS;
   * past the limit the fallback is the sample.
   */
  const maxZoom = useMemo(() => {
    const w = realDims?.w || post.width || 0;
    const h = realDims?.h || post.height || 0;
    if (!w || !h) return 4.5;
    return Math.max(2, Math.max(w / screenWidth, h / screenHeight));
  }, [realDims, post.width, post.height, screenWidth, screenHeight]);

  // The detail-resolved URL (XVideos fresh mp4/HLS, Gelbooru original) joins
  // the video candidates; the post's own URLs are used until it resolves.
  const videoCandidates = useMemo(
    () =>
      getVideoCandidates(
        resolvedOriginalUrl ? { ...post, originalUrl: resolvedOriginalUrl } : post
      ),
    [post, resolvedOriginalUrl]
  );
  // The resolved original stream (PH HLS etc.) is always primary: ranking
  // prefers mp4 over m3u8, so the cover flipbook (_fb.mp4) was crushing the
  // real video and only the preview played.
  const primaryCandidate = selectPrimaryVideoCandidate(
    resolvedOriginalUrl,
    videoCandidates,
    post.originalUrl || post.sampleUrl || post.previewUrl
  );
  const mediaUrl = getMediaUrl(primaryCandidate);

  const cleanMedia = primaryCandidate ? primaryCandidate.split('?')[0].toLowerCase() : '';
  // A resolved detail URL beats guessed list metadata: a Realbooru post scraped
  // as video can resolve to a GIF image (mistagged), which must render as image.
  const resolvedIsImage = Boolean(
    resolvedOriginalUrl && /\.(jpe?g|png|webp|gif|avif|bmp)$/.test(resolvedOriginalUrl.split('?')[0].toLowerCase())
  );
  // A Realbooru post tagged `gif` (without `video`) is an animated image even
  // when the listing scrape guessed an .mp4 extension (older saved records and
  // mistagged posts), so it must never reach the video player.
  const isGifPost = isGifMediaPost(post, resolvedOriginalUrl);
  const isVideo =
    !isGifPost &&
    !resolvedIsImage &&
    (Boolean(post.fileExt && ['mp4', 'webm', 'mov', 'm4v', 'm3u8'].includes(post.fileExt.toLowerCase())) ||
      Boolean(
        cleanMedia &&
          (cleanMedia.endsWith('.mp4') ||
            cleanMedia.endsWith('.webm') ||
            cleanMedia.endsWith('.mov') ||
            cleanMedia.endsWith('.m3u8') ||
            cleanMedia.endsWith('.m4v'))
      ));

  // iOS check: If on iOS and only .webm candidate is available, AVPlayer cannot play it
  const isWebmOnlyOnIOS =
    Platform.OS === 'ios' &&
    isVideo &&
    (videoCandidates.length > 0
      ? videoCandidates.every(isUnsupportedOnIOS)
      : (post.fileExt?.toLowerCase() === 'webm' || isUnsupportedOnIOS(primaryCandidate)));

  useEffect(() => {
    setUpgradedMp4Url(null);
  }, [primaryCandidate]);

  useEffect(() => {
    // Only try on iOS (Platform.OS check)
    if (Platform.OS !== 'ios' || !isWebmOnlyOnIOS || !primaryCandidate) {
      setUpgradedMp4Url(null);
      setIsCheckingUpgrade(false);
      return;
    }

    if (!isActive) {
      return;
    }

    let isMounted = true;
    setIsCheckingUpgrade(true);

    checkMp4UpgradeAvailable(primaryCandidate)
      .then((mp4) => {
        if (!isMounted) return;
        setUpgradedMp4Url(mp4);
        setIsCheckingUpgrade(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setUpgradedMp4Url(null);
        setIsCheckingUpgrade(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isActive, isWebmOnlyOnIOS, primaryCandidate]);

  const canPlayVideo =
    isVideo && videoCandidates.length > 0 && (!isWebmOnlyOnIOS || Boolean(upgradedMp4Url));
  const activeVideoUrl = upgradedMp4Url ? getMediaUrl(upgradedMp4Url) : mediaUrl;
  const isResolvingPornhubVideo =
    post.sourceId === 'pornhub' &&
    isActive &&
    Boolean(post.sourceLink) &&
    !resolvedOriginalUrl &&
    !videoResolveFailed;

  const uris = useMemo(() => getImageUris(post, quality), [post, quality]);

  const fullRawUri = resolvedOriginalUrl || post.originalUrl || uris.fullUri;
  const fullMediaUrl = getMediaUrl(fullRawUri);

  // GIFs get two layers: the cheap thumbnail cover paints first, then the full
  // animated file fades in above it. Realbooru GIFs are tens of MB with no
  // middle-size variant, so the cover must never wait on the full download.
  // Never hand a stale .mp4 guess to expo-image while detail is still resolving.
  const gifMediaUrl = isGifPost && /\.gif(?:[?#]|$)/i.test(fullRawUri) ? fullMediaUrl : '';
  const gifRequestUrl = gifProxyAttempt ? proxyService.forceProxyUrl(fullRawUri) : gifMediaUrl;
  // A stale record may first point the GIF layer at a guessed .mp4 (404); when
  // the detail resolve lands on the real .gif the layer gets a fresh attempt.
  useEffect(() => {
    setGifLoaded(false);
    setGifFailed(false);
    setGifError('');
    setGifProgress(null);
    setGifProxyAttempt(false);
  }, [gifMediaUrl]);
  // Stale as-video records point sample at a guessed .mp4 that 404s, so the
  // cover always falls back to the listing thumbnail on GIF/video posts.
  const baseImageRawUri =
    isVideo || (isGifPost && post.sourceId === 'realbooru')
      ? post.previewUrl
      : (post.sampleUrl || uris.sampleUri);
  const sampleMediaUrl = getMediaUrl(baseImageRawUri);
  const placeholderMediaUrl = getMediaUrl(uris.placeholderUri || post.previewUrl);

  const isFullQuality = quality === 'full' || forceFull;
  const isAutoZoomed = quality === 'auto' && (isZoomed || hasUpgradedToFull);
  const shouldMountFull =
    !isVideo &&
    !isGifPost &&
    Boolean(fullMediaUrl) &&
    fullMediaUrl !== sampleMediaUrl &&
    (isFullQuality || isAutoZoomed);


  const handleOpenSource = async () => {
    const targetUrl = post.sourceLink || post.originalUrl || post.sampleUrl;
    if (!targetUrl) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const supported = await Linking.canOpenURL(targetUrl);
      if (supported) {
        await Linking.openURL(targetUrl);
      }
    } catch (err) {
      console.warn('[ImageViewerModal] Failed to open source URL:', err);
    }
  };

  // Reset zoom & drag state when item becomes inactive
  useEffect(() => {
    if (!isActive) {
      dismissingRef.current = false;
      dragY.setValue(0);
    }
    if (!isActive && isZoomedRef.current && scrollRef.current) {
      scrollRef.current.scrollResponderZoomTo({
        x: 0,
        y: 0,
        width: screenWidth,
        height: screenHeight,
        animated: false,
      });
      isZoomedRef.current = false;
      setIsZoomed(false);
      onZoomChange?.(false);
    }
    if (!isActive && isMangaZoomedRef.current && mangaScrollRef.current) {
      mangaScrollRef.current.scrollResponderZoomTo({
        x: 0,
        y: 0,
        width: screenWidth,
        height: screenHeight,
        animated: false,
      });
      isMangaZoomedRef.current = false;
      setIsMangaZoomed(false);
      onZoomChange?.(false);
    }
  }, [isActive, onZoomChange, screenWidth, screenHeight, dragY]);

  const handleVideoLoaded = useCallback(() => {
    setSampleLoading(false);
  }, []);

  const handleVideoScrubbingChange = useCallback(
    (scrubbing: boolean) => {
      if (isScrubbingRef.current === scrubbing) return;
      isScrubbingRef.current = scrubbing;
      let updatedNatively = false;
      try {
        const nativeScroll: any = scrollRef.current;
        if (typeof nativeScroll?.setNativeProps === 'function') {
          nativeScroll.setNativeProps({ scrollEnabled: !scrubbing });
          updatedNatively = true;
        }
      } catch {}
      if (!updatedNatively) {
        setIsScrubbingActive(scrubbing);
      }
      onScrubbingChange?.(scrubbing);
    },
    [onScrubbingChange]
  );

  const verticalPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          !isZoomedRef.current &&
          !isScrubbingRef.current &&
          !dismissingRef.current &&
          post.sourceId !== 'nhentai' &&
          gesture.numberActiveTouches <= 1 &&
          Math.abs(gesture.dy) > 6 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.15,
        onMoveShouldSetPanResponderCapture: (_, gesture) =>
          !isZoomedRef.current &&
          !isScrubbingRef.current &&
          !dismissingRef.current &&
          post.sourceId !== 'nhentai' &&
          gesture.numberActiveTouches <= 1 &&
          Math.abs(gesture.dy) > 6 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.15,
        onPanResponderGrant: (_, gesture) => {
          dragStartDyRef.current = gesture?.dy ?? 0;
          (dragY as any).stopAnimation?.();
          if ((gesture?.dy ?? 0) < 0) {
            onInfoDragStart?.();
          }
        },
        onPanResponderMove: (_, gesture) => {
          const deltaY = gesture.dy - (dragStartDyRef.current ?? 0);
          if (deltaY > 0) {
            dragY.setValue(deltaY);
            onInfoDragMove?.(0);
          } else {
            dragY.setValue(Math.max(-24, deltaY * 0.08));
            onInfoDragMove?.(deltaY);
          }
        },
        onPanResponderRelease: (_, gesture) => {
          const startDy = dragStartDyRef.current ?? 0;
          dragStartDyRef.current = null;
          const deltaY = gesture.dy - startDy;
          if (
            (deltaY > 75 || (deltaY > 28 && gesture.vy > 0.45)) &&
            !dismissingRef.current
          ) {
            dismissingRef.current = true;
            onInfoDragEnd?.(false);
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Animated.timing(dragY, {
              toValue: screenHeight,
              duration: 130,
              useNativeDriver: true,
            }).start(() => {
              onClose(true);
            });
          } else if (deltaY < -48 || gesture.vy < -0.4) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Animated.spring(dragY, {
              toValue: 0,
              damping: 28,
              stiffness: 320,
              useNativeDriver: true,
            }).start();
            if (onInfoDragEnd) {
              onInfoDragEnd(true);
            } else {
              onOpenDetails();
            }
          } else {
            onInfoDragEnd?.(false);
            Animated.spring(dragY, {
              toValue: 0,
              damping: 28,
              stiffness: 320,
              useNativeDriver: true,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          dragStartDyRef.current = null;
          onInfoDragEnd?.(false);
          Animated.spring(dragY, {
            toValue: 0,
            damping: 28,
            stiffness: 320,
            useNativeDriver: true,
          }).start();
        },
        onPanResponderTerminationRequest: (_, gesture) => gesture.numberActiveTouches > 1,
      }),
    [dragY, post.sourceId, screenHeight, onClose, onOpenDetails, onInfoDragStart, onInfoDragMove, onInfoDragEnd]
  );

  const dragScale =
    typeof (dragY as any).interpolate === 'function'
      ? dragY.interpolate({
          inputRange: [-120, 0, 280],
          outputRange: [0.96, 1, 0.86],
          extrapolate: 'clamp',
        })
      : 1;
  const dragOpacity =
    typeof (dragY as any).interpolate === 'function'
      ? dragY.interpolate({
          inputRange: [0, 260],
          outputRange: [1, 0.25],
          extrapolate: 'clamp',
        })
      : 1;

  // Zoom state tracking (vertical pull-to-dismiss / pull-up-for-info is handled
  // cleanly on release by verticalPanResponder across both iOS and Android).
  const handleScroll = (e: any) => {
    const zoomScale = e.nativeEvent.zoomScale || 1;
    const zoomed = zoomScale > 1.05;
    if (zoomed !== isZoomedRef.current) {
      isZoomedRef.current = zoomed;
      setIsZoomed(zoomed);
      if (zoomed) {
        setHasUpgradedToFull(true);
      }
      onZoomChange?.(zoomed);
    }
  };

  // Double tap to zoom & single tap to toggle controls
  const handleImageTouch = (event: any) => {
    if (canPlayVideo || isVideo || isResolvingPornhubVideo || maxZoom <= 1) {
      onToggleControls();
      return;
    }

    const now = Date.now();
    const DOUBLE_TAP_DELAY = 190;

    if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
      // Clear pending single tap timer
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = 0;

      // Double Tap: Toggle Zoom
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (isZoomedRef.current) {
        // Zoom back out to 1x
        scrollRef.current?.scrollResponderZoomTo({
          x: 0,
          y: 0,
          width: screenWidth,
          height: screenHeight,
          animated: true,
        });
        isZoomedRef.current = false;
        setIsZoomed(false);
        onZoomChange?.(false);
      } else {
        // Double Tap: sharp zoom by resolution (never past 3x, capped by ceiling at low resolution)
        const tapZoom = Math.min(3, maxZoom);
        const { locationX, locationY } = event.nativeEvent;
        const targetWidth = screenWidth / tapZoom;
        const targetHeight = screenHeight / tapZoom;
        const targetX = Math.max(0, locationX - targetWidth / 2);
        const targetY = Math.max(0, locationY - targetHeight / 2);

        scrollRef.current?.scrollResponderZoomTo({
          x: targetX,
          y: targetY,
          width: targetWidth,
          height: targetHeight,
          animated: true,
        });
        isZoomedRef.current = true;
        setIsZoomed(true);
        setHasUpgradedToFull(true);
        onZoomChange?.(true);
      }
    } else {
      lastTapRef.current = now;
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
      }
      singleTapTimerRef.current = setTimeout(() => {
        singleTapTimerRef.current = null;
        onToggleControls();
      }, DOUBLE_TAP_DELAY);
    }
  };

  const handleMangaDoubleTap = (event: any) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 190;

    if (now - mangaLastTapRef.current < DOUBLE_TAP_DELAY) {
      if (mangaSingleTapTimerRef.current) {
        clearTimeout(mangaSingleTapTimerRef.current);
        mangaSingleTapTimerRef.current = null;
      }
      mangaLastTapRef.current = 0;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (isMangaZoomedRef.current) {
        // Back to 1x: stay on the current vertical page (no jump to page 1)
        const currentScale = mangaZoomScaleRef.current || 1;
        const targetY = Math.max(0, mangaOffsetYRef.current / currentScale);
        mangaScrollRef.current?.scrollResponderZoomTo({
          x: 0,
          y: targetY,
          width: screenWidth,
          height: screenHeight,
          animated: true,
        });
        isMangaZoomedRef.current = false;
        setIsMangaZoomed(false);
        onZoomChange?.(false);
      } else {
        // 2.2x integrated zoom onto the double-tapped page/point:
        // pageY is the absolute on-screen coordinate. Adding the ScrollView's
        // live scroll offset (mangaOffsetYRef.current) zooms exactly onto the tapped page.
        const tapZoom = 2.2;
        const pageX = event.nativeEvent.pageX ?? event.nativeEvent.locationX ?? (screenWidth / 2);
        const pageY = event.nativeEvent.pageY ?? (screenHeight / 2);
        const viewportY = Math.max(0, pageY - insetTop);
        const contentY = mangaOffsetYRef.current + viewportY;

        const targetWidth = screenWidth / tapZoom;
        const targetHeight = screenHeight / tapZoom;
        const targetX = Math.max(0, pageX - targetWidth / 2);
        const targetY = Math.max(0, contentY - targetHeight / 2);

        mangaScrollRef.current?.scrollResponderZoomTo({
          x: targetX,
          y: targetY,
          width: targetWidth,
          height: targetHeight,
          animated: true,
        });
        isMangaZoomedRef.current = true;
        setIsMangaZoomed(true);
        onZoomChange?.(true);
      }
    } else {
      mangaLastTapRef.current = now;
      if (mangaSingleTapTimerRef.current) {
        clearTimeout(mangaSingleTapTimerRef.current);
      }
      mangaSingleTapTimerRef.current = setTimeout(() => {
        mangaSingleTapTimerRef.current = null;
        onToggleControls();
      }, DOUBLE_TAP_DELAY);
    }
  };

  const defaultMangaPageHeight = useMemo(() => {
    if (post.width > 0 && post.height > 0) {
      return Math.round(screenWidth * (post.height / post.width));
    }
    if (post.aspectRatio && post.aspectRatio > 0) {
      return Math.round(screenWidth / post.aspectRatio);
    }
    return Math.round(screenWidth * 1.42);
  }, [post.width, post.height, post.aspectRatio, screenWidth]);

  const handleMeasuredMangaPageHeight = useCallback((index: number, height: number) => {
    mangaPageHeightsRef.current[index] = height;
  }, []);

  const handleMangaScroll = (e: any) => {
    const scale = e.nativeEvent.zoomScale || 1;
    const zoomed = scale > 1.05;
    mangaZoomScaleRef.current = scale;
    mangaOffsetYRef.current = e.nativeEvent.contentOffset.y;

    if (zoomed !== isMangaZoomedRef.current) {
      isMangaZoomedRef.current = zoomed;
      setIsMangaZoomed(zoomed);
      onZoomChange?.(zoomed);
    }

    // Live page indicator from vertical scroll (only update state when page changes)
    const offsetY = e.nativeEvent.contentOffset.y;
    const pagesCount = mangaPages.length || post.pageCount || 1;
    const targetY = (offsetY + screenHeight * 0.3) / Math.max(1, scale);
    let p = 1;
    let acc = 0;
    for (let i = 0; i < pagesCount; i++) {
      const h = mangaPageHeightsRef.current[i] ?? defaultMangaPageHeight;
      acc += h;
      if (targetY < acc) {
        p = i + 1;
        break;
      }
      p = i + 1;
    }
    if (p !== lastMangaPageRef.current) {
      lastMangaPageRef.current = p;
      setCurrentMangaPage(p);
    }
  };

  // nhentai: manga reader (integrated global canvas zoom)
  if (post.sourceId === 'nhentai') {
    // Before the page list resolves (or when it never does) show the best single
    // image we have — the real page 1 first, so the reader is never blank black.
    const firstImage = post.originalUrl || post.sampleUrl || post.previewUrl;
    const pages = mangaPages.length > 0 ? mangaPages : firstImage ? [firstImage] : [];
    return (
      <View style={{ width: screenWidth, height: screenHeight, backgroundColor: '#000000' }}>
        {mangaLoading && mangaPages.length === 0 ? (
          <View style={styles.loaderCenter} pointerEvents="none">
            <ActivityIndicator size="large" color={Colors.dark.primary} />
          </View>
        ) : null}

        <ScrollView
          ref={mangaScrollRef}
          style={{ width: screenWidth, height: screenHeight }}
          contentContainerStyle={{
            backgroundColor: '#000000',
            alignItems: 'center',
            paddingBottom: Math.max(insetBottom + 40, 60),
          }}
          maximumZoomScale={3.5}
          minimumZoomScale={1}
          bouncesZoom={true}
          showsVerticalScrollIndicator={true}
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={handleMangaScroll}
        >
          <TouchableWithoutFeedback onPress={handleMangaDoubleTap}>
            <View style={{ width: screenWidth, alignItems: 'center', backgroundColor: '#000000' }}>
              {pages.map((item, index) => {
                // Windowing: only the visible page ±5 is mounted. Downloading all
                // 50+ pages at once clogged mobile data and locked the reader;
                // distant pages wait as placeholders.
                const activeIdx = currentMangaPage - 1;
                const nearActive = Math.abs(index - activeIdx) <= 5;
                if (nearActive) {
                  return (
                    <MangaPageImage
                      key={`${item}-${index}`}
                      uri={item}
                      pageIndex={index}
                      pageLabel={String(index + 1)}
                      width={screenWidth}
                      defaultHeight={defaultMangaPageHeight}
                      onMeasuredHeight={handleMeasuredMangaPageHeight}
                    />
                  );
                }
                const placeholderHeight = mangaPageHeightsRef.current[index] ?? defaultMangaPageHeight;
                return (
                  <View
                    key={`${item}-${index}`}
                    style={{
                      width: screenWidth,
                      height: placeholderHeight,
                      backgroundColor: '#000000',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{ color: '#333333', fontSize: 13 }}>
                      {`${index + 1}`}
                    </Text>
                  </View>
                );
              })}
            </View>
          </TouchableWithoutFeedback>
        </ScrollView>

        {/* Floating Page Indicator Pill: Page X / Y */}
        <View
          style={[
            styles.mangaPagePill,
            { bottom: Math.max(insetBottom + 20, 28) },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.mangaPagePillText}>
            {currentMangaPage} / {mangaPages.length || post.pageCount || 1}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ width: screenWidth, height: screenHeight, backgroundColor: '#000000' }}>
      <Animated.View
        style={{
          flex: 1,
          opacity: dragOpacity,
          transform: [{ translateY: dragY }, { scale: dragScale }],
        }}
        {...verticalPanResponder.panHandlers}
      >
        <ScrollView
          ref={scrollRef}
          style={{ width: screenWidth, height: screenHeight }}
          contentContainerStyle={{ width: screenWidth, height: screenHeight, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }}
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          maximumZoomScale={canPlayVideo ? 1 : maxZoom}
          minimumZoomScale={1}
          bounces={isZoomed}
          bouncesZoom={true}
          centerContent={true}
          scrollEventThrottle={16}
          scrollEnabled={!isScrubbingActive}
          onScroll={handleScroll}
        >
          <TouchableWithoutFeedback onPress={handleImageTouch}>
            <View style={{ width: screenWidth, height: screenHeight, alignItems: 'center', justifyContent: 'center' }}>
              {/* PH bot-wall fallback runs behind the loader while resolving. */}
              {pornhubWebviewOn &&
              Platform.OS !== 'web' &&
              !resolvedOriginalUrl &&
              isActive &&
              !suspended &&
              post.sourceId === 'pornhub' &&
              post.sourceLink ? (
                <PornhubWebViewResolver
                  pageUrl={post.sourceLink}
                  onResolve={(files) => {
                    if (files) {
                      setResolvedOriginalUrl(files.high || files.hls || files.low || null);
                    } else {
                      setVideoResolveFailed(true);
                    }
                    setPornhubWebviewOn(false);
                  }}
                />
              ) : null}

              {isResolvingPornhubVideo ? (
                <View style={styles.loaderCenter} pointerEvents="none">
                  <ActivityIndicator size="large" color={Colors.dark.primary} />
                </View>
              ) : canPlayVideo && isActive ? (
                <VideoPlayerView
                  url={activeVideoUrl}
                  suspended={suspended}
                  showControls={showControls}
                  screenWidth={screenWidth}
                  screenHeight={screenHeight}
                  onLoaded={handleVideoLoaded}
                  onToggleControls={onToggleControls}
                  onSetControlsVisible={onSetControlsVisible}
                  onScrubbingChange={handleVideoScrubbingChange}
                />
              ) : (
              <>
              {/* Sample first-load indicator: while the sample hasn't painted yet and full hasn't loaded */}
              {sampleLoading && !sampleLoaded && !fullLoaded && (
                <View style={styles.loaderCenter} pointerEvents="none">
                  <ActivityIndicator size="large" color={Colors.dark.primary} />
                </View>
              )}

              {/* Full original download indicator: download percent/bytes while the sample already shows below */}
              {shouldMountFull && fullLoading && !fullLoaded && (
                <View style={styles.loaderCenter} pointerEvents="none">
                  <ActivityIndicator size="large" color={Colors.dark.primary} />
                  {fullProgress !== null ? (
                    <Text style={styles.loaderProgressText}>
                      %{Math.round(fullProgress * 100)}
                      {(fullTotalBytes > 0 || post.fileSize)
                        ? ` • ${formatMediaBytes(fullLoadedBytes, fullTotalBytes || post.fileSize || 0)}`
                        : ''}
                    </Text>
                  ) : fullLoadedBytes > 0 ? (
                    <Text style={styles.loaderProgressText}>
                      {formatMediaBytes(fullLoadedBytes, fullTotalBytes || post.fileSize || 0)}
                    </Text>
                  ) : null}
                </View>
              )}

              {/* Sample layer: fast first paint (low-res preview / sample) */}
              <Image
                source={{
                  uri: sampleMediaUrl,
                  headers: getMediaHeaders(sampleMediaUrl),
                }}
                placeholder={{
                  uri: placeholderMediaUrl,
                  headers: getMediaHeaders(placeholderMediaUrl),
                }}
                placeholderContentFit="contain"
                style={{ width: screenWidth, height: screenHeight }}
                contentFit="contain"
                contentPosition="center"
                priority={shouldMountFull ? 'normal' : 'high'}
                cachePolicy="memory-disk"
                allowDownscaling={!shouldMountFull && !(isFullQuality || isAutoZoomed)}
                transition={150}
                onLoadStart={() => setSampleLoading(true)}
                onLoadEnd={() => {
                  setSampleLoading(false);
                  setSampleLoaded(true);
                }}
                onError={() => setSampleLoading(false)}
              />

              {/* Animated GIF layer: the full file (many MB) fades in above the
                  thumbnail cover; if it never arrives the cover stays visible.
                  Only the visible page downloads it — neighbors keep the cover. */}
              {isGifPost && isActive && !suspended && gifMediaUrl && gifMediaUrl !== sampleMediaUrl && !gifFailed && (
                <Image
                  key={gifRequestUrl}
                  source={{
                    uri: gifRequestUrl,
                    headers: getMediaHeaders(gifRequestUrl),
                    isAnimated: true,
                    cacheKey: `${gifRequestUrl}:gif`,
                  }}
                  style={[
                    { width: screenWidth, height: screenHeight },
                    styles.fullImageLayer,
                    { opacity: gifLoaded ? 1 : 0 },
                  ]}
                  contentFit="contain"
                  contentPosition="center"
                  priority="high"
                  cachePolicy="disk"
                  autoplay
                  allowDownscaling
                  transition={150}
                  onLoad={() => setGifLoaded(true)}
                  onProgress={({ loaded, total }) => {
                    if (total > 0) setGifProgress(Math.min(1, loaded / total));
                  }}
                  onError={({ error }) => {
                    console.warn('[Viewer GIF] image load failed', post.id, error);
                    if (!gifProxyAttempt && proxyService.hasWorker() && !proxyService.isProxiedUrl(gifMediaUrl)) {
                      setGifProgress(null);
                      setGifProxyAttempt(true);
                      return;
                    }
                    setGifError(error);
                    setGifFailed(true);
                  }}
                />
              )}
              {isGifPost && isActive && !suspended && gifMediaUrl && gifMediaUrl !== sampleMediaUrl && !gifLoaded && !gifFailed && (
                <View style={styles.loaderCenter} pointerEvents="none">
                  <ActivityIndicator size="small" color={Colors.dark.primary} />
                  <Text style={styles.loaderProgressText}>
                    {gifProgress === null ? 'Loading GIF…' : `Loading GIF ${Math.round(gifProgress * 100)}%`}
                  </Text>
                </View>
              )}

              {/* Authoritative Full Original layer: mounted only in full mode or auto+zoom state */}
              {shouldMountFull && (
                <Image
                  source={{
                    uri: fullMediaUrl,
                    headers: getMediaHeaders(fullMediaUrl),
                    cacheKey: `${fullMediaUrl}:full-original`,
                  }}
                  style={[
                    { width: screenWidth, height: screenHeight },
                    styles.fullImageLayer,
                    { opacity: fullLoaded ? 1 : 0 },
                  ]}
                  contentFit="contain"
                  contentPosition="center"
                  priority="high"
                  cachePolicy="memory-disk"
                  allowDownscaling={false}
                  transition={150}
                  onLoadStart={() => {
                    setFullLoading(true);
                  }}
                  onLoad={() => {
                    setFullLoaded(true);
                    setFullLoading(false);
                  }}
                  onLoadEnd={() => {
                    setFullLoading(false);
                  }}
                  onError={() => {
                    setFullLoading(false);
                  }}
                  onProgress={(e: any) => {
                    const loaded = e?.loaded ?? e?.nativeEvent?.loaded;
                    let total = e?.total ?? e?.nativeEvent?.total;
                    if (typeof loaded === 'number' && loaded > 0) {
                      setFullLoadedBytes(loaded);
                    }
                    if ((!total || total <= 0) && post.fileSize && post.fileSize > 0) {
                      total = post.fileSize;
                    }
                    if (typeof total === 'number' && total > 0) {
                      setFullTotalBytes(total);
                    }
                    if (typeof loaded === 'number' && typeof total === 'number' && total > 0) {
                      setFullProgress(Math.min(1, Math.max(0, loaded / total)));
                    }
                  }}
                />
              )}
              {canPlayVideo && (
                <View style={styles.videoPlayOverlay}>
                  <Play size={36} color="#FFFFFF" fill="#FFFFFF" />
                </View>
              )}
              {isWebmOnlyOnIOS && isActive && isCheckingUpgrade && (
                <View style={styles.upgradeLoadingContainer} pointerEvents="none">
                  <View style={styles.upgradeLoadingBadge}>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  </View>
                </View>
              )}
              {isWebmOnlyOnIOS && isActive && !isCheckingUpgrade && !upgradedMp4Url && (
                <View style={styles.unsupportedCardContainer} pointerEvents="box-none">
                  <View style={styles.unsupportedCard}>
                    <View style={styles.unsupportedHeader}>
                      <AlertCircle size={22} color="#F5A623" />
                      <Text style={styles.unsupportedTitle}>This video cannot play on iOS (WebM)</Text>
                    </View>
                    <Text style={styles.unsupportedDescription}>
                      iOS does not natively support WebM. You can watch the video in your browser or on the source site.
                    </Text>
                    <TouchableOpacity
                      style={styles.unsupportedButton}
                      activeOpacity={0.8}
                      onPress={handleOpenSource}
                    >
                      <ExternalLink size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.unsupportedButtonText}>Open on Source</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              {/* A GIF that never arrives keeps the cover; offer the browser/source path.
                  Only once the layer points at a real .gif (a guessed .mp4 fails
                  first on old records and is replaced by the detail resolve). */}
              {isGifPost && isActive && !suspended && gifFailed &&
                gifMediaUrl.split('?')[0].toLowerCase().endsWith('.gif') && (
                <View style={styles.unsupportedCardContainer} pointerEvents="box-none">
                  <View style={styles.unsupportedCard}>
                    <View style={styles.unsupportedHeader}>
                      <AlertCircle size={22} color="#F5A623" />
                      <Text style={styles.unsupportedTitle}>GIF could not be loaded</Text>
                    </View>
                    <Text style={styles.unsupportedDescription}>
                      {gifError || 'The animated file could not be downloaded.'}
                    </Text>
                    <TouchableOpacity
                      style={styles.unsupportedButton}
                      activeOpacity={0.8}
                      onPress={() => {
                        setGifFailed(false);
                        setGifError('');
                        setGifProgress(null);
                        setResolveNonce((n) => n + 1);
                      }}
                    >
                      <RotateCcw size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.unsupportedButtonText}>Retry</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.unsupportedButton}
                      activeOpacity={0.8}
                      onPress={handleOpenSource}
                    >
                      <ExternalLink size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.unsupportedButtonText}>Open on Source</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              {/* If PH resolution dies show a card (retry / open on source) instead of a silent cover */}
              {post.sourceId === 'pornhub' &&
              isActive &&
              !suspended &&
              videoResolveFailed &&
              !resolvedOriginalUrl &&
              !canPlayVideo ? (
                <View style={styles.unsupportedCardContainer} pointerEvents="box-none">
                  <View style={styles.unsupportedCard}>
                    <View style={styles.unsupportedHeader}>
                      <AlertCircle size={22} color="#F5A623" />
                      <Text style={styles.unsupportedTitle}>Video could not be resolved</Text>
                    </View>
                    <Text style={styles.unsupportedDescription}>
                      Could not fetch Pornhub stream. Retry or watch on the source site.
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        style={styles.unsupportedButton}
                        activeOpacity={0.8}
                        onPress={() => {
                          setVideoResolveFailed(false);
                          setPornhubWebviewOn(false);
                          setResolveNonce((n) => n + 1);
                        }}
                      >
                        <RotateCcw size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                        <Text style={styles.unsupportedButtonText}>Retry</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.unsupportedButton, { backgroundColor: '#2A2E3B' }]}
                        activeOpacity={0.8}
                        onPress={handleOpenSource}
                      >
                        <ExternalLink size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                        <Text style={styles.unsupportedButtonText}>Open on Source</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              ) : null}
            </>
          )}
        </View>
      </TouchableWithoutFeedback>
    </ScrollView>
    </Animated.View>

    {/* HentaiHaven EP secici: ScrollView ve VideoPlayerView uzerinde yuzer */}
    {post.sourceId === 'hentaihaven' &&
    isActive &&
    !suspended &&
    hhEpisodes.length > 1 &&
    showControls ? (
      <View
        style={[
          styles.hhEpisodeBar,
          {
            top: Math.max(insetTop + 60, 76),
            left: Math.max(insetLeft + 8, 12),
            right: Math.max(insetRight + 8, 12),
          },
        ]}
        pointerEvents="box-none"
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.hhEpisodeRow}
        >
          {sortedHhEpisodes.map((ep) => {
            const selected = ep.ep === (hhActiveEp ?? sortedHhEpisodes[0].ep);
            return (
              <TouchableOpacity
                key={ep.url}
                style={[styles.hhEpisodeChip, selected && styles.hhEpisodeChipSelected]}
                activeOpacity={0.7}
                disabled={hhEpLoading}
                onPress={() => handleSelectHhEpisode(ep)}
              >
                <Text style={[styles.hhEpisodeText, selected && styles.hhEpisodeTextSelected]}>
                  EP {ep.ep}
                </Text>
              </TouchableOpacity>
            );
          })}
          {hhEpLoading ? (
            <ActivityIndicator size="small" color="#FFFFFF" style={{ marginLeft: 6 }} />
          ) : null}
        </ScrollView>
      </View>
    ) : null}
  </View>
);
});

// Helper to format playback time
const formatVideoTime = (seconds: number) => {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

// Global in-memory session mute preference (defaults to unmuted / sound ON: false)
let sessionVideoMuted = false;
const muteListeners = new Set<(muted: boolean) => void>();

const setSessionVideoMuted = (muted: boolean) => {
  sessionVideoMuted = muted;
  muteListeners.forEach((listener) => listener(muted));
};

interface VideoTimelineBarProps {
  player: ReturnType<typeof useVideoPlayer>;
  muted: boolean;
  insetBottom: number;
  insetLeft: number;
  insetRight: number;
  onToggleMute: () => void;
  onInteraction: () => void;
  onPauseHideTimer: () => void;
  onScrubbingChange: (isScrubbing: boolean) => void;
}

/**
 * Isolated playback progress + scrub bar so 250ms timeUpdate ticks and
 * scrub moves only re-render this lightweight card, not VideoPlayerView or PostPageItem.
 */
const VideoTimelineBar: React.FC<VideoTimelineBarProps> = React.memo(({
  player,
  muted,
  insetBottom,
  insetLeft,
  insetRight,
  onToggleMute,
  onInteraction,
  onPauseHideTimer,
  onScrubbingChange,
}) => {
  const [currentTime, setCurrentTime] = useState(() => {
    try {
      return player.currentTime || 0;
    } catch {
      return 0;
    }
  });
  const [duration, setDuration] = useState(() => {
    try {
      return player.duration || 0;
    } catch {
      return 0;
    }
  });
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);

  const durationRef = useRef(duration);
  durationRef.current = duration;
  const isScrubbingRef = useRef(false);
  isScrubbingRef.current = isScrubbing;

  const trackLayoutRef = useRef<{ pageX: number; width: number }>({ pageX: 0, width: 0 });
  const trackWrapperRef = useRef<ViewInstance>(null);

  useEventListener(player, 'timeUpdate', (event) => {
    if (!isScrubbingRef.current) {
      setCurrentTime(event.currentTime);
    }
    if (player.duration && player.duration > 0 && durationRef.current !== player.duration) {
      setDuration(player.duration);
    }
  });

  useEventListener(player, 'sourceLoad', () => {
    if (player.duration && player.duration > 0) {
      setDuration(player.duration);
    }
  });

  const measureTrack = useCallback(() => {
    trackWrapperRef.current?.measure((_x, _y, width, _height, pageX) => {
      if (width > 0) {
        trackLayoutRef.current = { pageX, width };
      }
    });
  }, []);

  const updateScrubFromPageX = useCallback(
    (pageX: number, commitToPlayer: boolean) => {
      const { pageX: trackX, width: trackW } = trackLayoutRef.current;
      const totalDuration = durationRef.current;
      if (trackW <= 0 || totalDuration <= 0) return;

      const relX = pageX - trackX;
      const progress = Math.max(0, Math.min(1, relX / trackW));
      const targetTime = progress * totalDuration;

      setScrubTime(targetTime);

      if (commitToPlayer) {
        player.currentTime = targetTime;
        setCurrentTime(targetTime);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    },
    [player]
  );

  const scrubberPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderTerminationRequest: () => false,

        onPanResponderGrant: (evt) => {
          isScrubbingRef.current = true;
          setIsScrubbing(true);
          onScrubbingChange(true);
          onPauseHideTimer();
          Haptics.selectionAsync();

          trackWrapperRef.current?.measure((_x, _y, width, _height, pageX) => {
            if (width > 0) {
              trackLayoutRef.current = { pageX, width };
            }
            updateScrubFromPageX(evt.nativeEvent.pageX, false);
          });
        },

        onPanResponderMove: (evt) => {
          updateScrubFromPageX(evt.nativeEvent.pageX, false);
        },

        onPanResponderRelease: (evt) => {
          updateScrubFromPageX(evt.nativeEvent.pageX, true);
          isScrubbingRef.current = false;
          setIsScrubbing(false);
          onScrubbingChange(false);
          onInteraction();
        },

        onPanResponderTerminate: () => {
          isScrubbingRef.current = false;
          setIsScrubbing(false);
          onScrubbingChange(false);
          onInteraction();
        },
      }),
    [updateScrubFromPageX, onInteraction, onPauseHideTimer, onScrubbingChange]
  );

  const displayTime = isScrubbing ? scrubTime : currentTime;
  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (displayTime / duration) * 100)) : 0;

  return (
    <View
      style={[
        styles.videoTimelineCard,
        {
          bottom: Math.max(insetBottom + 68, 92),
          left: Math.max(insetLeft + 8, 16),
          right: Math.max(insetRight + 8, 16),
        },
      ]}
    >
      <Text style={styles.videoTimeText}>{formatVideoTime(displayTime)}</Text>

      {/* Draggable & Tappable Timeline Scrubber */}
      <View
        ref={trackWrapperRef}
        style={styles.videoTimelineTrackWrapper}
        onLayout={measureTrack}
        {...scrubberPanResponder.panHandlers}
      >
        <View style={styles.videoTimelineTrack}>
          <View style={[styles.videoTimelineFill, { width: `${progressPercent}%` }]} />
          <View
            style={[
              styles.videoTimelineScrubber,
              { left: `${progressPercent}%` },
              isScrubbing && styles.videoTimelineScrubberActive,
            ]}
          />
        </View>
      </View>

      <Text style={styles.videoTimeText}>{formatVideoTime(duration)}</Text>

      {/* Mute / Unmute Button */}
      <TouchableOpacity
        style={styles.videoTimelineMuteBtn}
        onPress={onToggleMute}
        activeOpacity={0.7}
      >
        {muted ? (
          <VolumeX size={18} color="#FFFFFF" />
        ) : (
          <Volume2 size={18} color={GOLD_ACCENT} />
        )}
      </TouchableOpacity>
    </View>
  );
});

interface VideoPlayerViewProps {
  url: string;
  suspended?: boolean;
  showControls: boolean;
  screenWidth: number;
  screenHeight: number;
  onLoaded?: () => void;
  onToggleControls?: () => void;
  onSetControlsVisible?: (visible: boolean) => void;
  onScrubbingChange?: (isScrubbing: boolean) => void;
}

// Clean Video player component with expo-video and playback controls
const VideoPlayerView: React.FC<VideoPlayerViewProps> = React.memo(({
  url,
  suspended = false,
  showControls,
  screenWidth,
  screenHeight,
  onLoaded,
  onToggleControls,
  onSetControlsVisible,
  onScrubbingChange,
}) => {
  const insets = useSafeAreaInsets();
  const insetBottom = insets.bottom ?? 0;
  const insetLeft = insets.left ?? 0;
  const insetRight = insets.right ?? 0;
  const [muted, setMuted] = useState(sessionVideoMuted);
  const hideTimerRef = useRef<any>(null);
  const wasPlayingRef = useRef(false);
  const isScrubbingRef = useRef(false);
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;

  const videoSource = useMemo(
    () => ({
      uri: url,
      headers: getMediaHeaders(url),
    }),
    [url]
  );
  // On a TLS drop (e.g. api-cdn-mp4.rule34.xxx NSURLError -1200) a one-shot
  // selective proxy fallback: only this video is retried via the Worker,
  // the other candidates stay direct. If no Worker is configured (or Worker
  // also fails), fall back to downloading via the app's NSURLSession into
  // Paths.cache and playing the local file:// URI (bypasses iOS mediaserverd
  // AVFoundation TLS/cert rejections like realbooru.com -1202 without a Worker).
  const proxyFallbackDoneRef = useRef(false);
  const localFallbackDoneRef = useRef(false);
  const localDownloadAbortRef = useRef<AbortController | null>(null);
  const activeMediaUriRef = useRef(url);
  // If fallbacks die, go to a terminal error state instead of a black screen.
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLocalDownloading, setIsLocalDownloading] = useState(false);
  const [localDownloadProgress, setLocalDownloadProgress] = useState<number | null>(null);
  // Async continuations finishing after unmount must not touch the released player
  // (NotFoundException noise + setState after unmount).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      localDownloadAbortRef.current?.abort();
      localDownloadAbortRef.current = null;
    };
  }, []);
  // A format iOS AVPlayer cannot open (WebM) is never handed to the player:
  // show the error card directly instead of a -11828 warning storm.
  const blockedUrl = Platform.OS === 'ios' && isUnsupportedOnIOS(url);
  useEffect(() => {
    localDownloadAbortRef.current?.abort();
    localDownloadAbortRef.current = null;
    proxyFallbackDoneRef.current = false;
    localFallbackDoneRef.current = false;
    activeMediaUriRef.current = url;
    setLoadFailed(false);
    setIsLocalDownloading(false);
    setLocalDownloadProgress(null);
  }, [url]);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = sessionVideoMuted;
    p.timeUpdateEventInterval = 0.25;
  });

  useEffect(() => {
    return () => {
      try {
        player.pause();
        (player as { release?: () => void }).release?.();
      } catch (e) {
        // Skip silently if it is already released
      }
    };
  }, [player]);

  useEventListener(player, 'statusChange', (payload) => {
    if (payload.status !== 'error') return;

    if (
      proxyService.hasWorker() &&
      !proxyService.isProxiedUrl(url) &&
      !proxyFallbackDoneRef.current
    ) {
      proxyFallbackDoneRef.current = true;
      const viaProxy = proxyService.forceProxyUrl(url);
      if (viaProxy && viaProxy !== url) {
        activeMediaUriRef.current = viaProxy;
        (async () => {
          try {
            await player.replaceAsync({ uri: viaProxy, headers: getMediaHeaders(viaProxy) });
            if (!mountedRef.current) return;
            if (!suspendedRef.current) player.play();
          } catch (e) {
            if (mountedRef.current) console.warn('[VideoPlayerView] Proxy fallback failed:', e);
          }
        })();
        return;
      }
    }

    const canTryLocalDownload =
      !blockedUrl &&
      !localFallbackDoneRef.current &&
      Platform.OS !== 'web' &&
      /^https?:\/\//i.test(url) &&
      !proxyService.isProxiedUrl(url);

    if (canTryLocalDownload) {
      localFallbackDoneRef.current = true;
      localDownloadAbortRef.current?.abort();
      const ctrl = new AbortController();
      localDownloadAbortRef.current = ctrl;
      setIsLocalDownloading(true);
      setLocalDownloadProgress(null);

      (async () => {
        try {
          const localUri = await downloadVideoViaAppSession(
            url,
            getMediaHeaders(url),
            ctrl.signal,
            (ratio) => {
              if (mountedRef.current && !ctrl.signal.aborted) {
                setLocalDownloadProgress(ratio);
              }
            }
          );
          if (!mountedRef.current || ctrl.signal.aborted) return;
          activeMediaUriRef.current = localUri;
          setIsLocalDownloading(false);
          setLocalDownloadProgress(null);
          await player.replaceAsync({ uri: localUri });
          if (!mountedRef.current || ctrl.signal.aborted) return;
          if (!suspendedRef.current) player.play();
        } catch (e: any) {
          if (!mountedRef.current || ctrl.signal.aborted || e?.name === 'AbortError') return;
          console.warn('[VideoPlayerView] Local download fallback failed:', e);
          setIsLocalDownloading(false);
          setLocalDownloadProgress(null);
          setLoadFailed(true);
        }
      })();
      return;
    }

    setLoadFailed(true);
  });

  useEffect(() => {
    let isCurrent = true;

    if (!videoSource.uri || blockedUrl) {
      if (blockedUrl && mountedRef.current) setLoadFailed(true);
      return () => {
        isCurrent = false;
      };
    }

    (async () => {
      try {
        await player.replaceAsync(videoSource);
        if (!mountedRef.current) return;
        if (isCurrent && !suspendedRef.current) {
          player.play();
        }
      } catch (error) {
        if (isCurrent && mountedRef.current) console.warn('[VideoPlayerView] Async source failed:', error);
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, [player, videoSource, blockedUrl]);

  useEffect(() => {
    if (suspended) {
      try {
        wasPlayingRef.current = player.playing;
      } catch {
        wasPlayingRef.current = false;
      }
      try {
        player.pause();
      } catch {}
    } else {
      if (wasPlayingRef.current && !loadFailed) {
        wasPlayingRef.current = false;
        try {
          player.play();
        } catch {}
      }
    }
  }, [suspended, player, loadFailed]);

  // Sync mute state with session preference across videos
  useEffect(() => {
    const listener = (newMuted: boolean) => {
      setMuted(newMuted);
      player.muted = newMuted;
    };
    muteListeners.add(listener);
    return () => {
      muteListeners.delete(listener);
    };
  }, [player]);

  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });

  useEventListener(player, 'sourceLoad', () => {
    onLoaded?.();
  });

  const pauseHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  // Auto-hide unified controls after 3.5s of inactivity when video is playing
  const resetHideTimer = useCallback(() => {
    pauseHideTimer();
    if (isPlaying && !suspendedRef.current) {
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null;
        // Hiding mid-scrub: the overlay unmounts, the gesture terminates
        // and the pager lock would release, letting the finger scroll pages.
        if (isScrubbingRef.current) return;
        onSetControlsVisible?.(false);
      }, 3500);
    }
  }, [isPlaying, onSetControlsVisible, pauseHideTimer]);

  useEffect(() => {
    if (isPlaying && showControls && !suspended) {
      resetHideTimer();
    } else {
      pauseHideTimer();
    }
    return pauseHideTimer;
  }, [isPlaying, showControls, suspended, resetHideTimer, pauseHideTimer]);

  const handleToggleControls = useCallback(() => {
    Haptics.selectionAsync();
    onToggleControls?.();
  }, [onToggleControls]);

  const handlePlayPause = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
      resetHideTimer();
    }
  }, [isPlaying, player, resetHideTimer]);

  const handleSeekBackward = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    player.seekBy(-10);
    resetHideTimer();
  }, [player, resetHideTimer]);

  const handleSeekForward = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    player.seekBy(10);
    resetHideTimer();
  }, [player, resetHideTimer]);

  const toggleMute = useCallback(() => {
    Haptics.selectionAsync();
    const nextMuted = !muted;
    player.muted = nextMuted;
    setMuted(nextMuted);
    setSessionVideoMuted(nextMuted);
    resetHideTimer();
  }, [muted, player, resetHideTimer]);

  const handleTimelineScrubbingChange = useCallback(
    (scrubbing: boolean) => {
      isScrubbingRef.current = scrubbing;
      onScrubbingChange?.(scrubbing);
    },
    [onScrubbingChange]
  );

  const handleRetryLoad = useCallback(() => {
    if (!mountedRef.current || blockedUrl) return;
    localDownloadAbortRef.current?.abort();
    localDownloadAbortRef.current = null;
    setLoadFailed(false);
    setIsLocalDownloading(false);
    setLocalDownloadProgress(null);
    proxyFallbackDoneRef.current = false;
    localFallbackDoneRef.current = false;
    activeMediaUriRef.current = url;
    (async () => {
      try {
        await player.replaceAsync(videoSource);
        if (!mountedRef.current) return;
        if (!suspendedRef.current) player.play();
      } catch (e) {
        if (!mountedRef.current) return;
        console.warn('[VideoPlayerView] Manual retry failed:', e);
        setLoadFailed(true);
      }
    })();
  }, [player, videoSource, blockedUrl, url]);

  return (
    <View style={{ width: screenWidth, height: screenHeight, alignItems: 'center', justifyContent: 'center' }}>
      <VideoView
        style={{ width: screenWidth, height: screenHeight }}
        player={player}
        contentFit="contain"
        nativeControls={false}
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture={false}
        startsPictureInPictureAutomatically={false}
        pointerEvents="none"
      />

      {isLocalDownloading && !loadFailed && (
        <View style={styles.loaderCenter} pointerEvents="none">
          <ActivityIndicator size="large" color={Colors.dark.primary} />
          <Text style={styles.loaderProgressText}>
            {localDownloadProgress !== null
              ? `Buffering video %${Math.round(localDownloadProgress * 100)}`
              : 'Buffering video...'}
          </Text>
        </View>
      )}

      {/* If loading dies on both paths show an error card + retry instead of a black screen */}
      {loadFailed && (
        <View style={styles.unsupportedCardContainer} pointerEvents="box-none">
          <View style={styles.unsupportedCard}>
            <View style={styles.unsupportedHeader}>
              <AlertCircle size={22} color="#F5A623" />
              <Text style={styles.unsupportedTitle}>Video failed to load</Text>
            </View>
            <Text style={styles.unsupportedDescription}>
              Direct and proxy connections failed. Check your connection and retry.
            </Text>
            <TouchableOpacity
              style={styles.unsupportedButton}
              activeOpacity={0.8}
              onPress={handleRetryLoad}
            >
              <RotateCcw size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.unsupportedButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Tap catcher on video to toggle unified controls */}
      <TouchableWithoutFeedback onPress={handleToggleControls}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>

      {/* Video Playback Controls Overlay */}
      {showControls && (
        <View style={styles.videoControlsOverlay} pointerEvents="box-none">
          {/* Center Playback Controls: [-10s] [Play/Pause] [+10s] */}
          <View style={styles.videoCenterControlsRow}>
            {/* -10s Seek Backward */}
            <TouchableOpacity
              style={styles.videoSeekBtn}
              onPress={handleSeekBackward}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <RotateCcw size={22} color="#FFFFFF" />
              <Text style={styles.videoSeekText}>10</Text>
            </TouchableOpacity>

            {/* Main Play / Pause Button */}
            <TouchableOpacity
              style={styles.videoMainPlayBtn}
              onPress={handlePlayPause}
              activeOpacity={0.8}
            >
              {isPlaying ? (
                <Pause size={30} color="#FFFFFF" />
              ) : (
                <Play size={30} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 3 }} />
              )}
            </TouchableOpacity>

            {/* +10s Seek Forward */}
            <TouchableOpacity
              style={styles.videoSeekBtn}
              onPress={handleSeekForward}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <RotateCw size={22} color="#FFFFFF" />
              <Text style={styles.videoSeekText}>10</Text>
            </TouchableOpacity>
          </View>

          {/* Isolated Bottom Timeline & Duration Scrubber Bar */}
          <VideoTimelineBar
            player={player}
            muted={muted}
            insetBottom={insetBottom}
            insetLeft={insetLeft}
            insetRight={insetRight}
            onToggleMute={toggleMute}
            onInteraction={resetHideTimer}
            onPauseHideTimer={pauseHideTimer}
            onScrubbingChange={handleTimelineScrubbingChange}
          />
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  jumpOverlay: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpPanel: { backgroundColor: '#1C1D24', borderRadius: 16, padding: 24, width: '80%', maxWidth: 360 },
  jumpTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', marginBottom: 16 },
  jumpInput: { color: '#FFFFFF', borderColor: GOLD_ACCENT, borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 20 },
  jumpActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 28, marginTop: 20 },
  jumpAction: { color: GOLD_ACCENT, fontSize: 16, paddingVertical: 8 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
  container: {
    flex: 1,
    backgroundColor: '#000000',
    shadowColor: '#000000',
    shadowOffset: { width: -6, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
  },
  leftEdgeGestureArea: {
    position: 'absolute',
    left: 0,
    top: 75,
    // The bottom 150px is the video timeline strip: the edge-back area does not
    // cover it, a finger starting on the strip scrubs and does not trigger exit.
    bottom: 150,
    width: 28,
    zIndex: 999,
  },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 1000,
    elevation: 1000,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(32, 35, 42, 0.85)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  sourceText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    maxWidth: 120,
  },
  pageCountText: {
    color: Colors.dark.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  topSpacer: {
    width: 44,
    height: 44,
  },
  topHeader: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 1000,
    elevation: 1000,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  counterWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  circleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(32, 35, 42, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 5,
  },
  circleBtnFavActive: {
    backgroundColor: 'rgba(255, 77, 79, 0.25)',
    borderColor: '#FF4D4F',
  },
  circleBtnActive: {
    backgroundColor: 'rgba(245, 166, 35, 0.2)',
    borderColor: GOLD_ACCENT,
  },
  bottomActionBar: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 1000,
    elevation: 1000,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pageScroll: {
    flex: 1,
  },
  fullscreenImageViewport: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullImage: {
    flex: 1,
  },
  fullImageLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  videoWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlayOverlay: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoControlsOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoCenterControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 36,
  },
  videoSeekBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(24, 26, 34, 0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 5,
    elevation: 4,
  },
  videoSeekText: {
    position: 'absolute',
    bottom: 10,
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  videoMainPlayBtn: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: 'rgba(24, 26, 34, 0.85)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 8,
  },
  videoTimelineCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(24, 26, 34, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 10,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 6,
  },
  videoTimeText: {
    color: '#D0D4DC',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    minWidth: 32,
  },
  videoTimelineTrackWrapper: {
    flex: 1,
    height: 36,
    justifyContent: 'center',
  },
  videoTimelineTrack: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    position: 'relative',
    overflow: 'visible',
  },
  videoTimelineFill: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: GOLD_ACCENT,
  },
  videoTimelineScrubber: {
    position: 'absolute',
    top: -5.5,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    marginLeft: -8,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 3,
  },
  videoTimelineScrubberActive: {
    width: 20,
    height: 20,
    borderRadius: 10,
    top: -7.5,
    marginLeft: -10,
    backgroundColor: GOLD_ACCENT,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowOpacity: 0.7,
    shadowRadius: 5,
    elevation: 6,
  },
  videoTimelineMuteBtn: {
    padding: 6,
    marginLeft: 2,
  },
  loaderCenter: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loaderProgressText: {
    marginTop: 8,
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  detailsSheetOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 200,
    justifyContent: 'flex-end',
  },
  detailsSheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  detailsSheetContent: {
    backgroundColor: '#12141C',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    maxHeight: '75%',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.12)',
  },
  dragHandleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  sheetCloseBtn: {
    padding: 4,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#1A1E29',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 16,
  },
  metaItem: {
    alignItems: 'center',
  },
  metaLabel: {
    color: Colors.dark.textMuted,
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 4,
  },
  metaValue: {
    color: Colors.dark.text,
    fontSize: 13,
    fontWeight: '600',
  },
  tagSection: {
    backgroundColor: '#1A1E29',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  tagGroup: {
    marginBottom: 14,
  },
  tagGroupTitle: {
    color: Colors.dark.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  unsupportedCardContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    zIndex: 10,
  },
  unsupportedCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: 'rgba(20, 24, 33, 0.94)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  unsupportedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    gap: 8,
  },
  unsupportedTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },
  unsupportedDescription: {
    color: '#9BA3AF',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 16,
  },
  unsupportedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.dark.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  unsupportedButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  upgradeLoadingContainer: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  upgradeLoadingBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // HentaiHaven EP secici: ust barda baslik altinda yuzer yatay serit.
  hhEpisodeBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 30,
    elevation: 10,
  },
  hhEpisodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  hhEpisodeChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(20, 22, 30, 0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    marginRight: 8,
  },
  hhEpisodeChipSelected: {
    backgroundColor: Colors.dark.primary,
    borderColor: Colors.dark.primary,
  },
  hhEpisodeText: {
    color: '#E0E0E0',
    fontSize: 13,
    fontWeight: '700',
  },
  hhEpisodeTextSelected: {
    color: '#FFFFFF',
  },
  // nhentai: dikey okuyucu sayfa gosterge hapi (Sayfa X / Y)
  mangaPagePill: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.22)',
    zIndex: 25,
    elevation: 8,
  },
  mangaPagePillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
