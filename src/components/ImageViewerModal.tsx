import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Linking,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
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
  AlertCircle,
  ExternalLink,
  Smartphone,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BooruPost } from '../types/booru';
import { Colors } from '../theme/colors';
import { StorageService, ImageQuality } from '../services/storage';
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
  resolveGelbooruOriginalUrl,
  resolveRealDimensions,
  resolveXVideosVideoUrls,
  resolveXHamsterVideoUrls,
  resolvePornhubVideoUrls,
} from '../utils/media';

const { width: DEFAULT_SCREEN_WIDTH } = Dimensions.get('window');
const GOLD_ACCENT = '#F5A623';

/** Bayt + toplamdan '1.2 / 4.5 MB' metni */
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
  onIndexChange?: (index: number) => void;
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
}) => {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [showControls, setShowControls] = useState(true);
  const [isPlayingSlideshow, setIsPlayingSlideshow] = useState(false);
  const [isFav, setIsFav] = useState(false);
  const [showDetailsSheet, setShowDetailsSheet] = useState(false);
  const [isGalleryScrollEnabled, setIsGalleryScrollEnabled] = useState(true);
  // Info modalındaki Original satırından gelen tek seferlik full önizleme isteği
  const [previewOriginalId, setPreviewOriginalId] = useState<string | null>(null);
  const flatListRef = useRef<FlatList>(null);

  // Animated slide value for interactive edge swipe back
  const translateX = useRef(new Animated.Value(DEFAULT_SCREEN_WIDTH)).current;

  useEffect(() => {
    // Serbest mod sadece medya görüntüleyici açıkken verilir
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  useEffect(() => {
    onIndexChange?.(currentIndex);
  }, [currentIndex, onIndexChange]);

  // Döndürmede sayfa genişliği değişince aktif sayfaya geri hizala
  useEffect(() => {
    flatListRef.current?.scrollToOffset({
      offset: currentIndex * windowWidth,
      animated: false,
    });
  }, [windowWidth]);

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
      setPreviewOriginalId(null);

      if (asScreen || enterAnimation === 'none') {
        // Stack route: native stack owns the animation, stay put.
        translateX.setValue(0);
      } else {
        // Slide in smoothly from right
        translateX.setValue(0);
      }
    }
  }, [visible, initialIndex, enterAnimation, asScreen]);

  const currentPost = posts[currentIndex] || posts[0];

  useEffect(() => {
    if (currentPost) {
      StorageService.isFavorite(currentPost.id).then(setIsFav);
    }

    // Prefetch next 2 and previous 1 images with sample resolution into disk cache to avoid OOM
    if (visible && posts.length > 0) {
      const neighbors = [
        posts[currentIndex + 1],
        posts[currentIndex + 2],
        posts[currentIndex - 1],
      ].filter(Boolean);

      neighbors.forEach((p) => {
        const rawUrl = p.sampleUrl || p.previewUrl;
        if (!rawUrl) return;
        const url = getMediaUrl(rawUrl);
        if (url && !url.endsWith('.mp4') && !url.endsWith('.webm')) {
          Image.prefetch(url, {
            headers: getMediaHeaders(url),
            cachePolicy: 'disk',
          });
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
      toValue: windowWidth,
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
              toValue: windowWidth,
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

  const toggleOrientation = async () => {
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
    setIsPlayingSlideshow((prev) => !prev);
  };

  const viewerBody = (
    <View style={asScreen ? styles.container : styles.modalBackdrop}>
        {/* Animated Container */}
        <Animated.View
          style={[
            styles.container,
            {
              transform: asScreen ? [] : [{ translateX }],
            },
          ]}
        >
          {!asScreen && (
            <View style={styles.leftEdgeGestureArea} {...edgePanResponder.panHandlers} />
          )}

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
              length: windowWidth,
              offset: windowWidth * index,
              index,
            })}
            onMomentumScrollEnd={(e) => {
              const newIndex = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
              if (newIndex !== currentIndex && newIndex >= 0 && newIndex < posts.length) {
                setCurrentIndex(newIndex);
              }
            }}
            renderItem={({ item, index }) => (
              <PostPageItem
                post={item}
                isActive={index === currentIndex}
                suspended={suspended}
                forceFull={previewOriginalId === item.id}
                screenWidth={windowWidth}
                screenHeight={windowHeight}
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
            <View style={[styles.bottomActionBar, { bottom: Math.max(insets.bottom, 20) }]}>
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
            </View>
          )}

          {/* 4. POST INFO MODAL (Screenshot Style & Menu) */}
          <PostInfoModal
            visible={showDetailsSheet}
            post={currentPost}
            onClose={() => setShowDetailsSheet(false)}
            onPreviewOriginal={(p) => setPreviewOriginalId(p.id)}
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
  suspended?: boolean;
  /** Info modalındaki Original satırından tek seferlik full önizleme */
  forceFull?: boolean;
  screenWidth: number;
  screenHeight: number;
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
  suspended = false,
  forceFull = false,
  screenWidth,
  screenHeight,
  onToggleControls,
  onOpenDetails,
  onClose,
  onZoomChange,
  onScrubbingChange,
}) => {
  const [sampleLoading, setSampleLoading] = useState(true);
  const [sampleLoaded, setSampleLoaded] = useState(false);
  const [fullLoading, setFullLoading] = useState(false);
  const [fullLoaded, setFullLoaded] = useState(false);
  const [fullProgress, setFullProgress] = useState<number | null>(null);
  const [fullLoadedBytes, setFullLoadedBytes] = useState(0);
  const [fullTotalBytes, setFullTotalBytes] = useState(0);
  const [isDismissing, setIsDismissing] = useState(false);
  const [isScrubbingActive, setIsScrubbingActive] = useState(false);
  const [upgradedMp4Url, setUpgradedMp4Url] = useState<string | null>(null);
  const [isCheckingUpgrade, setIsCheckingUpgrade] = useState(false);
  const [quality, setQuality] = useState<ImageQuality>('auto');
  const [resolvedOriginalUrl, setResolvedOriginalUrl] = useState<string | null>(null);
  const [pornhubWebviewOn, setPornhubWebviewOn] = useState(false);
  const [videoResolveFailed, setVideoResolveFailed] = useState(false);
  const [realDims, setRealDims] = useState<{ w: number; h: number } | null>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [hasUpgradedToFull, setHasUpgradedToFull] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const lastTapRef = useRef<number>(0);
  const isZoomedRef = useRef<boolean>(false);
  const dismissingRef = useRef<boolean>(false);
  const singleTapTimerRef = useRef<any>(null);

  useEffect(() => {
    let isMounted = true;
    StorageService.getImageQuality().then((q) => {
      if (isMounted) setQuality(q);
    });
    return () => {
      isMounted = false;
    };
  }, [isActive]);

  useEffect(() => {
    let alive = true;
    const abortCtrl = new AbortController();

    setResolvedOriginalUrl(null);
    setPornhubWebviewOn(false);
    setVideoResolveFailed(false);

    // PH detay HTML'i ~1 MB: yalnız aktif sayfayı çöz. Komşuları aynı anda
    // parse etmek JS thread'ini saniyelerce bloke edip kontrolleri geciktirir.
    if (post.sourceId === 'pornhub' && !isActive) {
      return () => {
        alive = false;
        abortCtrl.abort();
      };
    }

    // Eğer post zaten sample'dan farklı gerçek bir originalUrl'e sahipse fetch etme
    // Not: XHamster ve XVideos süreli token/geçici preview taşıdığı için her zaman detaydan taze çözülür
    const needsFreshVideoResolution = post.sourceId === 'xvideos' || post.sourceId === 'xhamster';
    if (post.originalUrl && post.originalUrl !== post.sampleUrl && !needsFreshVideoResolution) {
      setResolvedOriginalUrl(post.originalUrl);
      return () => {
        alive = false;
        abortCtrl.abort();
      };
    }

    // Gelbooru/Realbooru/XVideos veya originalUrl eksik scrape gönderileri için
    // post detayından çöz (XVideos mp4'leri süreli token taşır, taze çözülür)
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
      } else if (post.sourceId === 'pornhub') {
        resolvePornhubVideoUrls(post, abortCtrl.signal)
          .then((files) => {
            if (!alive) return;
            if (files) {
              setResolvedOriginalUrl(files.high || files.hls || files.low || null);
            } else {
              // Hızlı yol bot-duvarına takıldı → gizli WebView yedeği
              setPornhubWebviewOn(true);
            }
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
  }, [isActive, post.id, post.sourceId, post.sourceLink, post.originalUrl, post.sampleUrl]);

  useEffect(() => {
    setIsZoomed(false);
    isZoomedRef.current = false;
    setPornhubWebviewOn(false);
    setVideoResolveFailed(false);
    setHasUpgradedToFull(false);
    setSampleLoading(true);
    setSampleLoaded(false);
    setFullLoading(false);
    setFullLoaded(false);
    setFullProgress(null);
    setFullLoadedBytes(0);
    setFullTotalBytes(0);
  }, [post.id]);

  // Gerçek çözünürlük: zoom tavanı hesabı için (oturum cache'li, tek seferlik).
  // Scrape placeholder (800x1000) yerine post sayfasındaki gerçek WxH.
  useEffect(() => {
    if (!isActive) return;
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
  }, [isActive, post.id, post.sourceLink, post.originalUrl, post.sampleUrl]);

  /**
   * Çözünürlüğe göre net zoom tavanı: contain-fit'te 1:1 piksele denk gelen
   * oran = max(imgW/ekranW, imgH/ekranH). Üst sınır yok — ne kadar
   * çözünürlük, o kadar zoom. Taban 2x (ekrandan küçük görselde bile
   * biraz yakınlaşma). NOT: çok büyük görsel + derin zoom iOS'ta
   * bellek baskısı yapar; limit aşımında fallback sample'dadır.
   */
  const maxZoom = useMemo(() => {
    const w = realDims?.w || post.width || 0;
    const h = realDims?.h || post.height || 0;
    if (!w || !h) return 4.5;
    return Math.max(2, Math.max(w / screenWidth, h / screenHeight));
  }, [realDims, post.width, post.height, screenWidth, screenHeight]);

  // Detaydan çözülen URL (XVideos taze mp4/HLS, Gelbooru original) video
  // adaylarına katılır; çözülene dek post'un kendi URL'leri kullanılır.
  const videoCandidates = useMemo(
    () =>
      getVideoCandidates(
        resolvedOriginalUrl ? { ...post, originalUrl: resolvedOriginalUrl } : post
      ),
    [post, resolvedOriginalUrl]
  );
  const primaryCandidate =
    videoCandidates.length > 0 ? videoCandidates[0] : post.originalUrl || post.sampleUrl || post.previewUrl;
  const mediaUrl = getMediaUrl(primaryCandidate);

  const cleanMedia = primaryCandidate ? primaryCandidate.split('?')[0].toLowerCase() : '';
  const isVideo =
    Boolean(post.fileExt && ['mp4', 'webm', 'mov', 'm4v', 'm3u8'].includes(post.fileExt.toLowerCase())) ||
    Boolean(
      cleanMedia &&
        (cleanMedia.endsWith('.mp4') ||
          cleanMedia.endsWith('.webm') ||
          cleanMedia.endsWith('.mov') ||
          cleanMedia.endsWith('.m3u8') ||
          cleanMedia.endsWith('.m4v'))
    );

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
    // Sadece iOS'ta dene (Platform.OS check)
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

  const baseImageRawUri = isVideo ? post.previewUrl : post.sampleUrl || uris.sampleUri;
  const sampleMediaUrl = getMediaUrl(baseImageRawUri);
  const placeholderMediaUrl = getMediaUrl(uris.placeholderUri || post.previewUrl);

  const fullRawUri = resolvedOriginalUrl || post.originalUrl || uris.fullUri;
  const fullMediaUrl = getMediaUrl(fullRawUri);

  const isFullQuality = quality === 'full' || forceFull;
  const isAutoZoomed = quality === 'auto' && (isZoomed || hasUpgradedToFull);
  const shouldMountFull =
    !isVideo &&
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

  // Reset zoom when item becomes inactive
  useEffect(() => {
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
  }, [isActive, onZoomChange, screenWidth, screenHeight]);

  // Swipe Down to Dismiss tracking (only active when not zoomed)
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

    if (!zoomed) {
      const offsetY = e.nativeEvent.contentOffset.y;
      if (offsetY < -80 && !dismissingRef.current) {
        dismissingRef.current = true;
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
      if (offsetY < -45 && !dismissingRef.current) {
        dismissingRef.current = true;
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
    if (canPlayVideo) {
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
          width: screenWidth,
          height: screenHeight,
          animated: true,
        });
        isZoomedRef.current = false;
        setIsZoomed(false);
        onZoomChange?.(false);
      } else {
        // Double Tap: çözünürlüğe göre net zoom (3x'i geçmez, düşük çözünürlükte tavana uyar)
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
        onToggleControls();
      }, DOUBLE_TAP_DELAY);
    }
  };

  return (
    <ScrollView
      ref={scrollRef}
      style={{ width: screenWidth, height: screenHeight }}
      contentContainerStyle={{ width: screenWidth, height: screenHeight, backgroundColor: '#000000', alignItems: 'center', justifyContent: 'center' }}
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      maximumZoomScale={canPlayVideo ? 1 : maxZoom}
      minimumZoomScale={1}
      bouncesZoom={true}
      centerContent={true}
      scrollEventThrottle={16}
      scrollEnabled={!isScrubbingActive}
      onScroll={handleScroll}
      onScrollEndDrag={handleScrollEndDrag}
    >
      <TouchableWithoutFeedback onPress={handleImageTouch}>
        <View style={{ width: screenWidth, height: screenHeight, alignItems: 'center', justifyContent: 'center' }}>
          {/* PH bot-duvarı yedeği çözüm sırasında loader'ın arkasında çalışır. */}
          {pornhubWebviewOn &&
          !resolvedOriginalUrl &&
          isActive &&
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
              screenWidth={screenWidth}
              screenHeight={screenHeight}
              onLoaded={() => setSampleLoading(false)}
              onScrubbingChange={(scrubbing) => {
                setIsScrubbingActive(scrubbing);
                onScrubbingChange?.(scrubbing);
              }}
            />
          ) : (
            <>
              {/* Sample ilk yükleme göstergesi: sample henüz boyanmamışken ve full yüklenmemişken */}
              {sampleLoading && !sampleLoaded && !fullLoaded && (
                <View style={styles.loaderCenter} pointerEvents="none">
                  <ActivityIndicator size="large" color={Colors.dark.primary} />
                </View>
              )}

              {/* Full original indirme göstergesi: altta sample zaten görünürken indirme yüzdesi/baytı */}
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

              {/* Sample katmanı: hızlı ilk boya (düşük çözünürlüklü önizleme / sample) */}
              <Image
                source={{
                  uri: sampleMediaUrl,
                  headers: getMediaHeaders(sampleMediaUrl),
                  cacheKey: `${sampleMediaUrl}:sample`,
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

              {/* Otoriter Full Original katmanı: sadece full modunda veya auto+zoom durumunda mount edilir */}
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
                      <Text style={styles.unsupportedTitle}>Bu video iOS'ta oynatılamıyor (WebM)</Text>
                    </View>
                    <Text style={styles.unsupportedDescription}>
                      iOS yerel olarak WebM biçimini desteklemez. Videoyu tarayıcınızda veya kaynak sitede izleyebilirsiniz.
                    </Text>
                    <TouchableOpacity
                      style={styles.unsupportedButton}
                      activeOpacity={0.8}
                      onPress={handleOpenSource}
                    >
                      <ExternalLink size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                      <Text style={styles.unsupportedButtonText}>Kaynakta Aç</Text>
                    </TouchableOpacity>
                  </View>
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
  suspended?: boolean;
  screenWidth: number;
  screenHeight: number;
  onLoaded?: () => void;
  onScrubbingChange?: (isScrubbing: boolean) => void;
}

// Clean Video player component with expo-video and playback controls
const VideoPlayerView: React.FC<VideoPlayerViewProps> = ({
  url,
  suspended = false,
  screenWidth,
  screenHeight,
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
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;

  const videoSource = useMemo(
    () => ({
      uri: url,
      headers: getMediaHeaders(url),
    }),
    [url]
  );
  // TLS düşüşünde (örn. api-cdn-mp4.rule34.xxx NSURLError -1200) tek seferlik
  // seçici proxy fallback'i: sadece bu video Worker üzerinden tekrar denenir,
  // diğer sonuçlar doğrudan kalır.
  const proxyFallbackDoneRef = useRef(false);
  useEffect(() => {
    proxyFallbackDoneRef.current = false;
  }, [url]);

  const player = useVideoPlayer(null, (p) => {
    p.loop = true;
    p.muted = sessionVideoMuted;
    p.timeUpdateEventInterval = 0.25;
  });

  useEventListener(player, 'statusChange', (payload) => {
    if (payload.status !== 'error' || proxyFallbackDoneRef.current) return;
    if (!proxyService.hasWorker() || proxyService.isProxiedUrl(url)) return;
    proxyFallbackDoneRef.current = true;
    const viaProxy = proxyService.forceProxyUrl(url);
    if (!viaProxy || viaProxy === url) return;
    (async () => {
      try {
        await player.replaceAsync({ uri: viaProxy, headers: getMediaHeaders(viaProxy) });
        if (!suspendedRef.current) player.play();
      } catch (e) {
        console.warn('[VideoPlayerView] Proxy fallback failed:', e);
      }
    })();
  });

  useEffect(() => {
    let isCurrent = true;

    if (!videoSource.uri) {
      return () => {
        isCurrent = false;
      };
    }

    (async () => {
      try {
        await player.replaceAsync(videoSource);
        if (isCurrent && !suspendedRef.current) {
          player.play();
        }
      } catch (error) {
        if (isCurrent) console.warn('[VideoPlayerView] Async source failed:', error);
      }
    })();

    return () => {
      isCurrent = false;
    };
  }, [player, videoSource]);

  useEffect(() => {
    if (suspended) {
      player.pause();
    }
  }, [suspended, player]);

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
});
