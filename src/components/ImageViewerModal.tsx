import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { useEvent, useEventListener } from 'expo';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import * as Haptics from 'expo-haptics';
import {
  Heart,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Info,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Image as ImageIcon,
  Tag,
  Volume2,
  VolumeX,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BooruPost } from '../types/booru';
import { Colors } from '../theme/colors';
import { StorageService } from '../services/storage';
import { TagChip } from './TagChip';
import { PostInfoModal } from './PostInfoModal';
import { getMediaHeaders, getMediaUrl } from '../utils/media';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GOLD_ACCENT = '#F5A623';

interface ImageViewerModalProps {
  posts: BooruPost[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
  onTagPress: (tag: string) => void;
  onAddTagToSearch?: (tag: string) => void;
  onExcludeTagFromSearch?: (tag: string) => void;
  /** 'none' ise açılışta sağdan kayma animasyonu oynatılmaz (geri dönüşte kullanılır). */
  enterAnimation?: 'slide' | 'none';
  /** Stack route olarak render ediliyorsa true: Modal sarmalayıcı yok,
      açılış/kapanış ve kenar kaydırma native stack'e bırakılır. */
  asScreen?: boolean;
  suspended?: boolean;
  dismissOnTagPress?: boolean;
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
}) => {
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [showControls, setShowControls] = useState(true);
  const [isPlayingSlideshow, setIsPlayingSlideshow] = useState(false);
  const [isFav, setIsFav] = useState(false);
  const [showDetailsSheet, setShowDetailsSheet] = useState(false);
  const [isGalleryScrollEnabled, setIsGalleryScrollEnabled] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  // Animated slide value for interactive edge swipe back
  const translateX = useRef(new Animated.Value(SCREEN_WIDTH)).current;

  useEffect(() => {
    if (suspended) {
      setIsPlayingSlideshow(false);
    }
  }, [suspended]);

  useEffect(() => {
    if (visible) {
      setCurrentIndex(initialIndex);
      setShowControls(true);
      setShowDetailsSheet(false);
      setIsPlayingSlideshow(false);
      setIsGalleryScrollEnabled(true);

      if (asScreen || enterAnimation === 'none') {
        // Stack route: native stack owns the animation, stay put.
        translateX.setValue(0);
      } else {
        // Slide in smoothly from right
        translateX.setValue(SCREEN_WIDTH);
        Animated.spring(translateX, {
          toValue: 0,
          damping: 28,
          stiffness: 240,
          mass: 0.9,
          useNativeDriver: true,
        }).start();
      }
    }
  }, [visible, initialIndex, enterAnimation]);

  const currentPost = posts[currentIndex] || posts[0];

  useEffect(() => {
    if (currentPost) {
      StorageService.isFavorite(currentPost.id).then(setIsFav);
    }

    // Prefetch next 2 and previous 1 images into memory-disk cache for instant paging
    if (visible && posts.length > 0) {
      const neighbors = [
        posts[currentIndex + 1],
        posts[currentIndex + 2],
        posts[currentIndex - 1],
      ].filter(Boolean);

      neighbors.forEach((p) => {
        const rawUrl = p.sampleUrl || p.originalUrl || p.previewUrl;
        const url = getMediaUrl(rawUrl);
        if (url && !url.endsWith('.mp4') && !url.endsWith('.webm')) {
          Image.prefetch(url, { headers: getMediaHeaders(url) });
        }
      });
    }
  }, [currentPost, currentIndex, visible, posts]);

  // Slideshow timer
  useEffect(() => {
    if (!isPlayingSlideshow) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => {
        const next = prev + 1;
        if (next < posts.length) {
          flatListRef.current?.scrollToIndex({ index: next, animated: true });
          return next;
        } else {
          setIsPlayingSlideshow(false);
          return prev;
        }
      });
    }, 3500);
    return () => clearInterval(timer);
  }, [isPlayingSlideshow, posts.length]);

  // Stack route modunda native stack yönetir: kendi açılış animasyonu ve
  // kenar kaydırma jesti devre dışı; translateX sabit 0'da durur.
  const isStackScreen = asScreen === true;
  const handleDismissWithSlide = () => {
    Haptics.selectionAsync();
    if (isStackScreen) {
      onClose();
      return;
    }
    Animated.timing(translateX, {
      toValue: SCREEN_WIDTH,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      onClose();
    });
  };

  // Interactive edge swipe gesture (Tracks finger live and reveals underlying previous screen)
  const edgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 8 && Math.abs(gesture.dy) < 35,
        onPanResponderMove: (_, gesture) => {
          if (gesture.dx > 0) {
            translateX.setValue(gesture.dx);
          }
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 80 || gesture.vx > 0.4) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            Animated.timing(translateX, {
              toValue: SCREEN_WIDTH,
              duration: 180,
              useNativeDriver: true,
            }).start(() => {
              onClose();
            });
          } else {
            Animated.spring(translateX, {
              toValue: 0,
              damping: 24,
              stiffness: 260,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [translateX, onClose]
  );

  if (!visible || !posts || posts.length === 0) return null;

  const handleToggleControls = () => {
    setShowControls((prev) => !prev);
  };

  const handleToggleFav = async () => {
    if (!currentPost) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newStatus = await StorageService.toggleFavorite(currentPost);
    setIsFav(newStatus);
  };

  const toggleDetails = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowDetailsSheet((prev) => !prev);
  };

  const toggleSlideshow = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsPlayingSlideshow((prev) => !prev);
  };

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
          {/* Left Edge Pan Strip (Isolated from top header so back button always clicks cleanly) */}
          <View style={styles.leftEdgeGestureArea} {...edgePanResponder.panHandlers} />

          {/* 1. HORIZONTAL MEDIA PAGER */}
          <FlatList
            ref={flatListRef}
            data={posts}
            keyExtractor={(item, index) => `${item.id}-${index}`}
            horizontal
            pagingEnabled
            scrollEnabled={isGalleryScrollEnabled}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(initialIndex, posts.length - 1)}
            windowSize={3}
            maxToRenderPerBatch={1}
            initialNumToRender={1}
            removeClippedSubviews
            getItemLayout={(_, index) => ({
              length: SCREEN_WIDTH,
              offset: SCREEN_WIDTH * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const newIndex = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
              if (newIndex !== currentIndex && newIndex >= 0 && newIndex < posts.length) {
                setCurrentIndex(newIndex);
              }
            }}
            renderItem={({ item, index }) => (
              <PostPageItem
                post={item}
                isActive={index === currentIndex}
                onToggleControls={handleToggleControls}
                onOpenDetails={() => setShowDetailsSheet(true)}
                onClose={handleDismissWithSlide}
                onTagPress={onTagPress}
                onZoomChange={(isZoomed) => setIsGalleryScrollEnabled(!isZoomed)}
                onScrubbingChange={(isScrubbing) => setIsGalleryScrollEnabled(!isScrubbing)}
              />
            )}
          />

          {/* 2. TOP FLOATING BAR */}
          {showControls && (
            <View style={[styles.topBar, { top: Math.max(insets.top, 16) }]}>
              <TouchableOpacity
                style={styles.circleBtn}
                onPress={handleDismissWithSlide}
                hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                activeOpacity={0.7}
              >
                <ChevronLeft size={24} color="#FFFFFF" />
              </TouchableOpacity>

              {/* Source & Position Badge */}
              <View style={styles.sourceBadge}>
                <Text style={styles.sourceText} numberOfLines={1}>
                  {currentPost?.sourceName || 'Booru'}
                </Text>
                <Text style={styles.pageCountText}>
                  {currentIndex + 1} / {posts.length}
                </Text>
              </View>

              {/* Top Right Spacer to balance header */}
              <View style={styles.topSpacer} />
            </View>
          )}

          {/* 3. BOTTOM ACTION BAR (Left: Heart, Center: Slideshow, Right: Info) */}
          {showControls && (
            <View style={[styles.bottomActionBar, { bottom: Math.max(insets.bottom, 20) }]}>
              {/* Left Heart '♡' Button */}
              <TouchableOpacity
                style={[styles.circleBtn, isFav && styles.circleBtnFavActive]}
                onPress={handleToggleFav}
                activeOpacity={0.7}
              >
                <Heart
                  size={22}
                  color={isFav ? '#FF4D4F' : '#FFFFFF'}
                  fill={isFav ? '#FF4D4F' : 'transparent'}
                />
              </TouchableOpacity>

              {/* Center Slideshow Button */}
              <TouchableOpacity
                style={[styles.circleBtn, isPlayingSlideshow && styles.circleBtnActive]}
                onPress={toggleSlideshow}
                activeOpacity={0.7}
              >
                {isPlayingSlideshow ? (
                  <Pause size={20} color={GOLD_ACCENT} />
                ) : (
                  <Play size={20} color="#FFFFFF" fill="#FFFFFF" style={{ marginLeft: 2 }} />
                )}
              </TouchableOpacity>

              {/* Right Info 'ⓘ' Button */}
              <TouchableOpacity
                style={[styles.circleBtn, showDetailsSheet && styles.circleBtnActive]}
                onPress={toggleDetails}
                activeOpacity={0.7}
              >
                <Info size={22} color={showDetailsSheet ? GOLD_ACCENT : '#FFFFFF'} />
              </TouchableOpacity>
            </View>
          )}

          {/* 4. POST INFO MODAL (Screenshot Style & Menu) */}
          <PostInfoModal
            visible={showDetailsSheet}
            post={currentPost}
            onClose={() => setShowDetailsSheet(false)}
            onSearchTag={(tag) => {
              setShowDetailsSheet(false);
              onClose();
              setTimeout(() => {
                onTagPress(tag);
              }, 80);
            }}
            onAddTagToSearch={(tag) => {
              setShowDetailsSheet(false);
              onClose();
              setTimeout(() => {
                if (onAddTagToSearch) {
                  onAddTagToSearch(tag);
                } else {
                  onTagPress(tag);
                }
              }, 80);
            }}
            onExcludeTagFromSearch={(tag) => {
              setShowDetailsSheet(false);
              onClose();
              setTimeout(() => {
                if (onExcludeTagFromSearch) {
                  onExcludeTagFromSearch(tag);
                } else {
                  onTagPress(`-${tag}`);
                }
              }, 80);
            }}
          />
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
      onRequestClose={handleDismissWithSlide}
    >
      {viewerBody}
    </Modal>
  );
};

interface PostPageItemProps {
  post: BooruPost;
  isActive: boolean;
  onToggleControls: () => void;
  onOpenDetails: () => void;
  onClose: () => void;
  onTagPress: (tag: string) => void;
  onZoomChange?: (isZoomed: boolean) => void;
  onScrubbingChange?: (isScrubbing: boolean) => void;
}

const PostPageItem: React.FC<PostPageItemProps> = ({
  post,
  isActive,
  onToggleControls,
  onOpenDetails,
  onClose,
  onZoomChange,
  onScrubbingChange,
}) => {
  const [imageLoading, setImageLoading] = useState(true);
  const [isDismissing, setIsDismissing] = useState(false);
  const [isScrubbingActive, setIsScrubbingActive] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const lastTapRef = useRef<number>(0);
  const isZoomedRef = useRef<boolean>(false);
  const singleTapTimerRef = useRef<any>(null);

  const rawMedia = post.originalUrl || post.sampleUrl || post.previewUrl;
  const mediaUrl = getMediaUrl(rawMedia);
  const isVideo =
    Boolean(post.fileExt && ['mp4', 'webm', 'mov', 'm4v'].includes(post.fileExt.toLowerCase())) ||
    Boolean(rawMedia && (rawMedia.endsWith('.mp4') || rawMedia.endsWith('.webm') || rawMedia.endsWith('.mov')));

  const mainImageUri = getMediaUrl(isVideo ? post.previewUrl : post.sampleUrl || post.originalUrl || post.previewUrl);
  const placeholderUri = getMediaUrl(post.previewUrl || post.sampleUrl);

  // Reset zoom when item becomes inactive
  useEffect(() => {
    if (!isActive && isZoomedRef.current && scrollRef.current) {
      scrollRef.current.scrollResponderZoomTo({
        x: 0,
        y: 0,
        width: SCREEN_WIDTH,
        height: SCREEN_HEIGHT,
        animated: false,
      });
      isZoomedRef.current = false;
      onZoomChange?.(false);
    }
  }, [isActive, onZoomChange]);

  // Swipe Down to Dismiss tracking (only active when not zoomed)
  const handleScroll = (e: any) => {
    const zoomScale = e.nativeEvent.zoomScale || 1;
    const isZoomed = zoomScale > 1.05;
    if (isZoomed !== isZoomedRef.current) {
      isZoomedRef.current = isZoomed;
      onZoomChange?.(isZoomed);
    }

    if (!isZoomed) {
      const offsetY = e.nativeEvent.contentOffset.y;
      if (offsetY < -80 && !isDismissing) {
        setIsDismissing(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onClose();
      } else if (offsetY > 70) {
        onOpenDetails();
      }
    }
  };

  const handleScrollEndDrag = (e: any) => {
    const zoomScale = e.nativeEvent.zoomScale || 1;
    if (zoomScale <= 1.05) {
      const offsetY = e.nativeEvent.contentOffset.y;
      if (offsetY < -45 && !isDismissing) {
        setIsDismissing(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onClose();
      } else if (offsetY > 50) {
        onOpenDetails();
      }
    }
  };

  // Double tap to zoom & single tap to toggle controls
  const handleImageTouch = (event: any) => {
    if (isVideo) {
      onToggleControls();
      return;
    }

    const now = Date.now();
    const DOUBLE_TAP_DELAY = 280;

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
          width: SCREEN_WIDTH,
          height: SCREEN_HEIGHT,
          animated: true,
        });
        isZoomedRef.current = false;
        onZoomChange?.(false);
      } else {
        // Zoom in to 3x centered around touched location
        const { locationX, locationY } = event.nativeEvent;
        const targetWidth = SCREEN_WIDTH / 3;
        const targetHeight = SCREEN_HEIGHT / 3;
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
        onZoomChange?.(true);
      }
    } else {
      lastTapRef.current = now;
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
      }
      singleTapTimerRef.current = setTimeout(() => {
        onToggleControls();
      }, DOUBLE_TAP_DELAY);
    }
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.pageScroll}
      contentContainerStyle={styles.fullscreenImageViewport}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      maximumZoomScale={isVideo ? 1 : 4.5}
      minimumZoomScale={1}
      bouncesZoom={true}
      centerContent={true}
      scrollEventThrottle={16}
      scrollEnabled={!isScrubbingActive}
      onScroll={handleScroll}
      onScrollEndDrag={handleScrollEndDrag}
    >
      <TouchableWithoutFeedback onPress={handleImageTouch}>
        <View style={styles.fullscreenImageViewport}>
          {isVideo && isActive ? (
            <VideoPlayerView
              url={mediaUrl}
              onLoaded={() => setImageLoading(false)}
              onScrubbingChange={(scrubbing) => {
                setIsScrubbingActive(scrubbing);
                onScrubbingChange?.(scrubbing);
              }}
            />
          ) : (
            <>
              {imageLoading && (
                <View style={styles.loaderCenter}>
                  <ActivityIndicator size="large" color={Colors.dark.primary} />
                </View>
              )}
              <Image
                source={{
                  uri: mainImageUri,
                  headers: getMediaHeaders(mainImageUri),
                }}
                placeholder={{
                  uri: placeholderUri,
                  headers: getMediaHeaders(placeholderUri),
                }}
                placeholderContentFit="contain"
                style={styles.fullImage}
                contentFit="contain"
                priority="high"
                cachePolicy="memory-disk"
                transition={150}
                onLoadEnd={() => setImageLoading(false)}
              />
              {isVideo && (
                <View style={styles.videoPlayOverlay}>
                  <Play size={36} color="#FFFFFF" fill="#FFFFFF" />
                </View>
              )}
            </>
          )}
        </View>
      </TouchableWithoutFeedback>
    </ScrollView>
  );
};

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

interface VideoPlayerViewProps {
  url: string;
  onLoaded?: () => void;
  onScrubbingChange?: (isScrubbing: boolean) => void;
}

// Clean Video player component with expo-video and playback controls
const VideoPlayerView: React.FC<VideoPlayerViewProps> = ({
  url,
  onLoaded,
  onScrubbingChange,
}) => {
  const insets = useSafeAreaInsets();
  const [muted, setMuted] = useState(sessionVideoMuted);
  const [showControls, setShowControls] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [timelineWidth, setTimelineWidth] = useState(0);
  const hideTimerRef = useRef<any>(null);

  const videoSource = useMemo(
    () => ({
      uri: url,
      headers: getMediaHeaders(url),
    }),
    [url]
  );

  const player = useVideoPlayer(videoSource, (p) => {
    p.loop = true;
    p.muted = sessionVideoMuted;
    p.timeUpdateEventInterval = 0.25;
    p.play();
  });

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

  useEventListener(player, 'timeUpdate', (event) => {
    setCurrentTime(event.currentTime);
    if (player.duration && player.duration > 0 && duration !== player.duration) {
      setDuration(player.duration);
    }
  });

  useEventListener(player, 'sourceLoad', () => {
    if (player.duration && player.duration > 0) {
      setDuration(player.duration);
    }
    onLoaded?.();
  });

  // Auto-hide controls after 3.5s of inactivity when video is playing
  const resetHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    if (isPlaying) {
      hideTimerRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3500);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (isPlaying && showControls) {
      resetHideTimer();
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isPlaying, showControls, resetHideTimer]);

  const handleToggleControls = () => {
    Haptics.selectionAsync();
    setShowControls((prev) => {
      const next = !prev;
      if (next) resetHideTimer();
      return next;
    });
  };

  const handlePlayPause = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isPlaying) {
      player.pause();
    } else {
      player.play();
      resetHideTimer();
    }
  };

  const handleSeekBackward = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    player.seekBy(-10);
    resetHideTimer();
  };

  const handleSeekForward = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    player.seekBy(10);
    resetHideTimer();
  };

  const toggleMute = () => {
    Haptics.selectionAsync();
    const nextMuted = !muted;
    player.muted = nextMuted;
    setMuted(nextMuted);
    setSessionVideoMuted(nextMuted);
    resetHideTimer();
  };

  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);

  const durationRef = useRef(0);
  durationRef.current = duration;
  const isScrubbingRef = useRef(false);
  isScrubbingRef.current = isScrubbing;

  const trackLayoutRef = useRef<{ pageX: number; width: number }>({ pageX: 0, width: 0 });
  const trackWrapperRef = useRef<View>(null);

  const measureTrack = useCallback(() => {
    trackWrapperRef.current?.measure((_x, _y, width, _height, pageX) => {
      if (width > 0) {
        trackLayoutRef.current = { pageX, width };
        setTimelineWidth(width);
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
          setIsScrubbing(true);
          onScrubbingChange?.(true);
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          Haptics.selectionAsync();

          // Measure track position immediately on touch
          trackWrapperRef.current?.measure((_x, _y, width, _height, pageX) => {
            if (width > 0) {
              trackLayoutRef.current = { pageX, width };
              setTimelineWidth(width);
            }
            updateScrubFromPageX(evt.nativeEvent.pageX, false);
          });
        },

        onPanResponderMove: (evt) => {
          updateScrubFromPageX(evt.nativeEvent.pageX, false);
        },

        onPanResponderRelease: (evt) => {
          updateScrubFromPageX(evt.nativeEvent.pageX, true);
          setIsScrubbing(false);
          onScrubbingChange?.(false);
          resetHideTimer();
        },

        onPanResponderTerminate: () => {
          setIsScrubbing(false);
          onScrubbingChange?.(false);
          resetHideTimer();
        },
      }),
    [updateScrubFromPageX, resetHideTimer, onScrubbingChange]
  );

  const displayTime = isScrubbing ? scrubTime : currentTime;
  const progressPercent =
    duration > 0 ? Math.min(100, Math.max(0, (displayTime / duration) * 100)) : 0;

  return (
    <View style={styles.videoWrapper}>
      <VideoView
        style={styles.fullImage}
        player={player}
        contentFit="contain"
        nativeControls={false}
        fullscreenOptions={{ enable: false }}
        allowsPictureInPicture={false}
        startsPictureInPictureAutomatically={false}
        pointerEvents="none"
      />

      {/* Tap catcher on video to toggle video controls */}
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

          {/* Bottom Timeline & Duration Scrubber Bar */}
          <View
            style={[
              styles.videoTimelineCard,
              { bottom: Math.max(insets.bottom + 68, 92) },
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
              onPress={toggleMute}
              activeOpacity={0.7}
            >
              {muted ? (
                <VolumeX size={18} color="#FFFFFF" />
              ) : (
                <Volume2 size={18} color={GOLD_ACCENT} />
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
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
    bottom: 85,
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
    width: SCREEN_WIDTH,
    flex: 1,
  },
  fullscreenImageViewport: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  videoWrapper: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
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
    maxHeight: SCREEN_HEIGHT * 0.7,
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
});
