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
  isVideoPost,
  resolveGelbooruOriginalUrl,
  resolveRealDimensions,
  resolveXVideosVideoUrls,
  resolveXHamsterVideoUrls,
  resolvePornhubVideoUrls,
  selectPrimaryVideoCandidate,
} from '../utils/media';
import { resolveSexComVideoUrls, selectSexComPlayable } from '../services/sexcom';
import { resolveHentaiHavenEpisodeUrls, listHentaiHavenEpisodes, resolveHentaiHavenEpisodeUrl, HentaiHavenEpisode } from '../services/hentaihavens';
import { resolveNHentaiPages, resolveNHentaiGalleryDetail, rotateNhentaiImageHost } from '../services/nhentai';

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
  /** Video timeline scrub durumu üst katmana bildirilir (geri jesti kilidi için). */
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
  // asScreen'de 0'dan başlar: ilk karede ekran dışında flash olmasın.
  const translateX = useRef(new Animated.Value(asScreen ? 0 : DEFAULT_SCREEN_WIDTH)).current;

  useEffect(() => {
    // Serbest mod sadece medya görüntüleyici açıkken verilir
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {});
    };
  }, []);

  useEffect(() => {
    onIndexChange?.(currentIndex);
    // Sayfa değişince kaydırma kilidini sıfırla: zoom/scrub sırasında
    // unmount olan sayfa kilidi takılı bırakabiliyordu.
    setIsGalleryScrollEnabled(true);
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
    } else if (visible) {
      // Odağa dönünce kontrolleri geri getir: gizli kalıp tap'in
      // yutulduğu "kontroller gitti" durumunu sıfırlar.
      setShowControls(true);
    }
  }, [suspended, visible]);

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
  // Video sayfalarında özel kenar geri alanı devrede (native jest kapalı);
  // fotoğrafta native jest çalışır, bu alan kapalıdır.
  const currentIsVideo = isVideoPost(currentPost);

  useEffect(() => {
    if (currentPost) {
      StorageService.isFavorite(currentPost.id).then(setIsFav);
    }

    // Prefetch next 2 and previous 1 images with sample resolution into disk cache to avoid OOM
    // Arka plandaki (suspended) ekranlar prefetch yapmaz: üst üste binen
    // istekler JS thread'ini kitleyip kontrolleri geciktiriyordu.
    if (visible && !suspended && posts.length > 0) {
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
  }, [currentPost, currentIndex, visible, suspended, posts]);

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

  // Interactive edge swipe gesture. Modal modda görünüm parmağı takip eder
  // (arkada transparan backdrop + gerçek önceki ekran vardır). Stack modunda
  // takip siyah boşluk gösterirdi: eşik beklenir, bırakınca native
  // animasyonlu pop çalışır ve önceki ekran görünür.
  const edgePanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, gesture) =>
          gesture.dx > 8 && Math.abs(gesture.dy) < 35,
        onPanResponderMove: (_, gesture) => {
          if (!asScreen && gesture.dx > 0) {
            translateX.setValue(gesture.dx);
          }
        },
        onPanResponderRelease: (_, gesture) => {
          if (gesture.dx > 80 || gesture.vx > 0.4) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            if (asScreen) {
              onClose();
              return;
            }
            Animated.timing(translateX, {
              toValue: windowWidth,
              duration: 180,
              useNativeDriver: true,
            }).start(() => {
              onClose();
            });
          } else if (!asScreen) {
            Animated.spring(translateX, {
              toValue: 0,
              damping: 24,
              stiffness: 260,
              useNativeDriver: true,
            }).start();
          }
        },
      }),
    [translateX, onClose, asScreen]
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

  // Stabil callbackler: her render'da yeni kimlik üretilince PostPageItem
  // içindeki effect'ler gereksiz tetikleniyordu.
  // Senkron native kilit: scrub/zoom başlayınca state güncellemesi
  // re-render köprüsünden geçene kadar yatay pager parmağı native tarafta
  // kapıp sayfa kaydırabiliyor. setNativeProps köprüyü beklemeden native
  // scroller'ı durdurur; state tutarlılık için aynen durur.
  const setGalleryScrollSynchronously = useCallback((enabled: boolean) => {
    setIsGalleryScrollEnabled(enabled);
    try {
      const list: any = flatListRef.current as any;
      const nativeRef = list?.getNativeScrollRef?.() ?? list;
      nativeRef?.setNativeProps?.({ scrollEnabled: enabled });
    } catch {}
  }, []);
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
          {/* Sol kenar geri alanı: modal modunda ve video sayfalarında
              (native jest kapalıyken). Alt 150px video timeline şeridi
              kapsam dışı: şeritte başlayan parmak seek yapar, çıkış olmaz. */}
          {(!asScreen || currentIsVideo) && (
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
                onTagsResolved={(tags, allTags, numFavorites) => {
                  item.tags = tags;
                  item.allTags = allTags;
                  // Skor = favori sayısı: liste HTML'inde yok, detayda gelir
                  if (numFavorites) {
                    item.score = numFavorites;
                    item.favCount = numFavorites;
                  }
                }}
                showControls={showControls}
                screenWidth={windowWidth}
                screenHeight={windowHeight}
                onToggleControls={handleToggleControls}
                onOpenDetails={() => setShowDetailsSheet(true)}
                onClose={handleDismissWithSlide}
                onTagPress={onTagPress}
                onZoomChange={handleZoomChange}
                onScrubbingChange={handleScrubbingChange}
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

/**
 * Manga tek sayfa görseli: hata verirse sıradaki CDN hostuna geçer
 * (i2->i3->i4->i1; bazı ağlar tekil hostları engeller). Yüklenmeyen sayfa
 * boş siyah kare yerine minik yükleniyor göstergesi + sayfa numarası gösterir.
 */
const MangaPageImage: React.FC<{
  uri: string;
  pageLabel: string;
  width: number;
  height: number;
}> = React.memo(({ uri, pageLabel, width, height }) => {
  const [src, setSrc] = React.useState(uri);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    setSrc(uri);
    setFailed(false);
  }, [uri]);
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
            uri: src,
            headers: getMediaHeaders(src),
            cacheKey: `${src}:manga-page`,
          }}
          style={{ width, height }}
          contentFit="contain"
          contentPosition="center"
          cachePolicy="memory-disk"
          transition={150}
          onError={() => {
            const next = rotateNhentaiImageHost(src);
            if (next) {
              setSrc(next);
            } else {
              setFailed(true);
            }
          }}
        />
      ) : (
        <Text style={{ color: '#666666', fontSize: 13 }}>
          {`Sayfa ${pageLabel} yüklenemedi`}
        </Text>
      )}
    </View>
  );
});

interface PostPageItemProps {
  post: BooruPost;
  isActive: boolean;
  suspended?: boolean;
  /** Info modalındaki Original satırından tek seferlik full önizleme */
  forceFull?: boolean;
  showControls?: boolean;
  screenWidth: number;
  screenHeight: number;
  onTagsResolved?: (
    tags: BooruPost['tags'],
    allTags: string[],
    numFavorites?: number
  ) => void;
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
  showControls = true,
  screenWidth,
  screenHeight,
  onTagsResolved,
  onToggleControls,
  onOpenDetails,
  onClose,
  onZoomChange,
  onScrubbingChange,
}) => {
  const insets = useSafeAreaInsets();
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
  // Çözümleme ölürse "Tekrar Dene" bu sayacı artırıp effect'i yeniden koşturur.
  const [resolveNonce, setResolveNonce] = useState(0);
  const [pornhubWebviewOn, setPornhubWebviewOn] = useState(false);
  const [videoResolveFailed, setVideoResolveFailed] = useState(false);
  const [realDims, setRealDims] = useState<{ w: number; h: number } | null>(null);
  // HentaiHaven: seri karti -> bolum listesi + secili bolum (EP secici).
  const [hhEpisodes, setHhEpisodes] = useState<HentaiHavenEpisode[]>([]);
  const [hhActiveEp, setHhActiveEp] = useState<number | null>(null);
  const [hhEpLoading, setHhEpLoading] = useState(false);
  const sortedHhEpisodes = useMemo(
    () => [...hhEpisodes].sort((a, b) => a.ep - b.ep),
    [hhEpisodes]
  );
  // nhentai: manga dikey okuyucu sayfaları ve aktif sayfa göstergesi
  const [mangaPages, setMangaPages] = useState<string[]>([]);
  const [mangaLoading, setMangaLoading] = useState(false);
  const [currentMangaPage, setCurrentMangaPage] = useState(1);
  const [isMangaZoomed, setIsMangaZoomed] = useState(false);
  const mangaScrollRef = useRef<ScrollView>(null);
  const isMangaZoomedRef = useRef(false);
  const mangaLastTapRef = useRef<number>(0);
  const mangaSingleTapTimerRef = useRef<any>(null);
  const mangaOffsetYRef = useRef<number>(0);
  const mangaZoomScaleRef = useRef<number>(1);
  const [isZoomed, setIsZoomed] = useState(false);
  const [hasUpgradedToFull, setHasUpgradedToFull] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const lastTapRef = useRef<number>(0);
  const isZoomedRef = useRef<boolean>(false);
  const dismissingRef = useRef<boolean>(false);
  const singleTapTimerRef = useRef<any>(null);

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

    // Arka plandaki ekran (üstte SearchDetail varken) detay çözümlemez:
    // aynı anda N ekranın resolve etmesi thread'i kitleyip dokunmatiği öldürüyordu.
    if (suspended) {
      return () => {
        alive = false;
        abortCtrl.abort();
      };
    }

    // PH detay HTML'i ~1 MB: yalnız aktif sayfayı çöz. Komşuları aynı anda
    // parse etmek JS thread'ini saniyelerce bloke edip kontrolleri geciktirir.
    if (post.sourceId === 'pornhub' && !isActive) {
      return () => {
        alive = false;
        abortCtrl.abort();
      };
    }

    // Eğer post zaten sample'dan farklı gerçek bir originalUrl'e sahipse fetch etme
    // Not: XHamster, XVideos, Sex.com ve HentaiHaven süreli token/geçici preview taşıdığı için her zaman detaydan taze çözülür
    const needsFreshVideoResolution = post.sourceId === 'xvideos' || post.sourceId === 'xhamster' || post.sourceId === 'sexcom' || post.sourceId === 'hentaihaven';
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
      } else if (post.sourceId === 'sexcom') {
        resolveSexComVideoUrls(post, abortCtrl.signal)
          .then((files) => {
            if (!alive) return;
            if (files) {
              // Premium kilitli HLS anonim oynaticida acilmaz: sessizce
              // onizlemeye dusulur (hata kartindan iyidir) ama sebebi
              // Metro'da gorunur olsun. HLS'siz detay da aynidir.
              if (files.premium) {
                console.warn('[Viewer] sexcom premium video, önizleme oynuyor');
              } else if (!files.hls) {
                console.warn('[Viewer] sexcom tam video bulunamadı, önizleme oynuyor');
              }
              setResolvedOriginalUrl(selectSexComPlayable(files));
            } else {
              // Detay cekilemedi (direkt + worker ikisi de olmedi): izleyici
              // karttaki onizlemede kalir. Metro'daki bu satir sebebini soyler.
              console.warn('[Viewer] sexcom detay çözülemedi, önizleme oynuyor');
            }
          })
          .catch(() => {});
      } else if (post.sourceId === 'hentaihaven') {
        StorageService.getLastWatchedEpisode(post.id)
          .then((savedEp) => {
            if (!alive) return;
            return resolveHentaiHavenEpisodeUrls(post, abortCtrl.signal, savedEp)
              .then((files) => {
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
                const playable = files?.hls || files?.mp4;
                if (playable) {
                  console.log('[Viewer] hentaihaven bölüm çözüldü, oynatılıyor');
                  setResolvedOriginalUrl(playable);
                } else {
                  // Seri/bölüm çekilemedi ya da HLS yok: kapak fotoğrafta kalır.
                  console.warn('[Viewer] hentaihaven bölüm çözülemedi, kapak kalıyor');
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
  }, [isActive, suspended, resolveNonce, post.id, post.sourceId, post.sourceLink, post.originalUrl, post.sampleUrl]);

  // HentaiHaven: seri kartindaki tum bolumler (EP secici icin yedek).
  // Ana resolve sirasinda zaten gelir; gelmediyse tek seferlik buradan denenir.
  useEffect(() => {
    if (post.sourceId !== 'hentaihaven' || !isActive || suspended || !post.sourceLink) return;
    if (hhEpisodes.length > 0) return;
    let alive = true;
    const ctrl = new AbortController();
    listHentaiHavenEpisodes(post, ctrl.signal)
      .then((eps) => {
        if (!alive || eps.length === 0) return;
        setHhEpisodes(eps);
        setHhActiveEp((cur) => (cur === null ? eps[0].ep : cur));
      })
      .catch(() => {});
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [isActive, suspended, post.id, post.sourceId, post.sourceLink, hhEpisodes.length]);

  const handleSelectHhEpisode = useCallback(
    (ep: HentaiHavenEpisode) => {
      if (hhEpLoading || ep.ep === hhActiveEp) return;
      const baseM = post.sourceLink?.match(/^https?:\/\/[^/]+/i);
      const base = baseM ? baseM[0] : 'https://hentaihaven.xxx';
      const url = base + ep.url;
      setHhActiveEp(ep.ep);
      setHhEpLoading(true);
      setResolvedOriginalUrl(null);
      // Son izlenen / seçilen bölümü cihaz hafızasına kaydet (favoriden açıldığında da buradan başlar).
      StorageService.setLastWatchedEpisode(post.id, ep.ep).catch(() => {});
      resolveHentaiHavenEpisodeUrl(url)
        .then((files) => {
          const playable = files?.hls || files?.mp4;
          if (playable) {
            console.log('[Viewer] hentaihaven bölüm çözüldü, oynatılıyor (EP ' + ep.ep + ')');
            setResolvedOriginalUrl(playable);
          } else {
            console.warn('[Viewer] hentaihaven bölüm çözülemedi, kapak kalıyor (EP ' + ep.ep + ')');
          }
        })
        .catch(() => {})
        .finally(() => setHhEpLoading(false));
    },
    [hhEpLoading, hhActiveEp, post.id, post.sourceLink]
  );

  // Sigorta: fetch + WebView toplamı 30 sn'yi geçerse spinner'ı öldürüp
  // Tekrar Dene kartını göster. (Asılı bağlantıda hiçbir dal sonlanmayabiliyordu.)
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
  }, [post.id]);

  // Gerçek çözünürlük: zoom tavanı hesabı için (oturum cache'li, tek seferlik).
  // Scrape placeholder (800x1000) yerine post sayfasındaki gerçek WxH.
  useEffect(() => {
    if (!isActive || suspended) return;
    // Video sitelerinde (PH/XV/XH) izleme sayfasında boyut bilgisi yok;
    // ölçü listeden gelir (PH 640x360). Bu fetch, video açılışındaki
    // çift sayfa indirmenin yarısıydı — atlanınca kasma azalır.
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

  // nhentai: manga albümünün tüm sayfalarını ve etiketlerini çözer (dikey okuyucu için)
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
        }
        // Detaydan gelen kategorize etiketleri Info paneline aktar
        if (detail.allTags && detail.allTags.length > 0) {
          onTagsResolved?.(detail.tags, detail.allTags, detail.numFavorites);
        } else if (detail.numFavorites) {
          onTagsResolved?.(post.tags, post.allTags, detail.numFavorites);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setMangaLoading(false);
      });
    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [isActive, suspended, post.id, post.sourceId, post.sourceLink, post.mediaId, post.pageCount]);

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
  // Çözülmüş orijinal akış (PH HLS vb.) her zaman birincildir: sıralama
  // mp4'ü m3u8'ten üstün tuttuğu için kapak flipbook'u (_fb.mp4) gerçek
  // videoyu eziyor, sadece önizleme oynuyordu.
  const primaryCandidate = selectPrimaryVideoCandidate(
    resolvedOriginalUrl,
    videoCandidates,
    post.originalUrl || post.sampleUrl || post.previewUrl
  );
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
      if (post.sourceId === 'nhentai') return;
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
    if (post.sourceId === 'nhentai') return;
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

  const handleMangaDoubleTap = (event: any) => {
    const now = Date.now();
    const DOUBLE_TAP_DELAY = 280;

    if (now - mangaLastTapRef.current < DOUBLE_TAP_DELAY) {
      if (mangaSingleTapTimerRef.current) {
        clearTimeout(mangaSingleTapTimerRef.current);
        mangaSingleTapTimerRef.current = null;
      }
      mangaLastTapRef.current = 0;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      if (isMangaZoomedRef.current) {
        // 1x'e geri dön: o an bulunulan dikey sayfada kal (1. sayfaya sıçrama yapma)
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
        // Çift dokunulan sayfaya/noktaya 2.2x tümleşik zoom:
        // pageY ekran üstü mutlak koordinattır. ScrollView'ın anlık kaydırma
        // ofseti (mangaOffsetYRef.current) eklenerek tam dokunulan sayfaya zoom yapılır.
        const tapZoom = 2.2;
        const pageX = event.nativeEvent.pageX ?? event.nativeEvent.locationX ?? (screenWidth / 2);
        const pageY = event.nativeEvent.pageY ?? (screenHeight / 2);
        const viewportY = Math.max(0, pageY - insets.top);
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
        onToggleControls();
      }, DOUBLE_TAP_DELAY);
    }
  };

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

    // Dikey kaydırmaya göre anlık sayfa göstergesi
    const pageHeight = Math.round(screenWidth * 1.42);
    const offsetY = e.nativeEvent.contentOffset.y;
    const effectivePageHeight = pageHeight * scale;
    if (effectivePageHeight > 0) {
      const pagesCount = mangaPages.length || post.pageCount || 1;
      const p = Math.min(
        pagesCount,
        Math.max(1, Math.floor((offsetY + screenHeight * 0.3) / effectivePageHeight) + 1)
      );
      setCurrentMangaPage(p);
    }
  };

  // nhentai: manga okuyucu (tümleşik global canvas zoom)
  if (post.sourceId === 'nhentai') {
    const pages = mangaPages.length > 0 ? mangaPages : [post.sampleUrl || post.previewUrl];
    const pageHeight = Math.round(screenWidth * 1.42);
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
            paddingBottom: Math.max(insets.bottom + 40, 60),
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
                // Pencereleme: yalnız görünen sayfa ±5 monte edilir. 50+ sayfanın
                // hepsini aynı anda indirmek mobil hattı tıkayıp okuyucuyu
                // kilitliyordu; uzak sayfalar yer tutucu olarak bekler.
                const activeIdx = currentMangaPage - 1;
                const nearActive = Math.abs(index - activeIdx) <= 5;
                return (
                  <View
                    key={`${item}-${index}`}
                    style={{
                      width: screenWidth,
                      height: pageHeight,
                      backgroundColor: '#000000',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {nearActive ? (
                      <MangaPageImage
                        uri={item}
                        pageLabel={String(index + 1)}
                        width={screenWidth}
                        height={pageHeight}
                      />
                    ) : (
                      <Text style={{ color: '#333333', fontSize: 13 }}>
                        {`${index + 1}`}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          </TouchableWithoutFeedback>
        </ScrollView>

        {/* Floating Page Indicator Pill: Sayfa X / Y */}
        <View
          style={[
            styles.mangaPagePill,
            { bottom: Math.max(insets.bottom + 20, 28) },
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
                screenWidth={screenWidth}
                screenHeight={screenHeight}
                onLoaded={() => setSampleLoading(false)}
                onToggleControls={onToggleControls}
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
              {/* PH çözümleme öldüyse sessiz kapak yerine kart: tekrar dene / kaynakta aç */}
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
                      <Text style={styles.unsupportedTitle}>Video çözümlenemedi</Text>
                    </View>
                    <Text style={styles.unsupportedDescription}>
                      Pornhub akışı alınamadı. Tekrar dene veya kaynak sitede izle.
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
                        <Text style={styles.unsupportedButtonText}>Tekrar Dene</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.unsupportedButton, { backgroundColor: '#2A2E3B' }]}
                        activeOpacity={0.8}
                        onPress={handleOpenSource}
                      >
                        <ExternalLink size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
                        <Text style={styles.unsupportedButtonText}>Kaynakta Aç</Text>
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

    {/* HentaiHaven EP secici: ScrollView ve VideoPlayerView uzerinde yuzer */}
    {post.sourceId === 'hentaihaven' &&
    isActive &&
    !suspended &&
    hhEpisodes.length > 1 &&
    showControls ? (
      <View
        style={[
          styles.hhEpisodeBar,
          { top: Math.max(insets.top + 60, 76) },
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
  onToggleControls?: () => void;
  onScrubbingChange?: (isScrubbing: boolean) => void;
}

// Clean Video player component with expo-video and playback controls
const VideoPlayerView: React.FC<VideoPlayerViewProps> = ({
  url,
  suspended = false,
  screenWidth,
  screenHeight,
  onLoaded,
  onToggleControls,
  onScrubbingChange,
}) => {
  const insets = useSafeAreaInsets();
  const [muted, setMuted] = useState(sessionVideoMuted);
  const [showControls, setShowControls] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [timelineWidth, setTimelineWidth] = useState(0);
  const hideTimerRef = useRef<any>(null);
  const wasPlayingRef = useRef(false);
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
  // Proxy yedeği de ölürse siyah ekranda kalmasın diye terminal hata durumu.
  const [loadFailed, setLoadFailed] = useState(false);
  // Unmount sonrası biten async devamları bırakılmış oyuncuya dokunmasın
  // (NotFoundException gürültüsü + unmount sonrası setState).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  // iOS AVPlayer'ın açamadığı format (WebM) oyuncuya hiç verilmez:
  // -11828 uyarı fırtınası yerine doğrudan hata kartı.
  const blockedUrl = Platform.OS === 'ios' && isUnsupportedOnIOS(url);
  useEffect(() => {
    proxyFallbackDoneRef.current = false;
    setLoadFailed(false);
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
        // Zaten serbest bırakılmışsa sessizce geç
      }
    };
  }, [player]);

  useEventListener(player, 'statusChange', (payload) => {
    if (payload.status === 'error' && proxyFallbackDoneRef.current) {
      setLoadFailed(true);
      return;
    }
    if (payload.status !== 'error' || proxyFallbackDoneRef.current) return;
    if (!proxyService.hasWorker() || proxyService.isProxiedUrl(url)) {
      // Yedek yol yok: sessiz siyah ekranda kalmasın, hata kartını göster.
      setLoadFailed(true);
      return;
    }
    proxyFallbackDoneRef.current = true;
    const viaProxy = proxyService.forceProxyUrl(url);
    if (!viaProxy || viaProxy === url) return;
    (async () => {
      try {
        await player.replaceAsync({ uri: viaProxy, headers: getMediaHeaders(viaProxy) });
        if (!mountedRef.current) return;
        if (!suspendedRef.current) player.play();
      } catch (e) {
        if (mountedRef.current) console.warn('[VideoPlayerView] Proxy fallback failed:', e);
      }
    })();
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
      // Odağa dönünce kontrolleri geri getir + oynatılıyorsa devam et.
      // Donmuş video + gizli kontrol "kontroller gitti" hissi veriyordu.
      setShowControls(true);
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
        // Scrub ortasında gizleme: overlay unmount olur, gesture terminate
        // olur, pager kilidi açılıp parmağı takip ederdi.
        if (isScrubbingRef.current) return;
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
    onToggleControls?.();
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
          // Native taraf kilidi düşürürse her harekette yeniden vur.
          onScrubbingChange?.(true);
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

  const handleRetryLoad = useCallback(() => {
    if (!mountedRef.current || blockedUrl) return;
    setLoadFailed(false);
    proxyFallbackDoneRef.current = false;
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
  }, [player, videoSource, blockedUrl]);

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

      {/* Yükleme iki yoldan da öldüyse siyah ekran yerine hata kartı + tekrar dene */}
      {loadFailed && (
        <View style={styles.unsupportedCardContainer} pointerEvents="box-none">
          <View style={styles.unsupportedCard}>
            <View style={styles.unsupportedHeader}>
              <AlertCircle size={22} color="#F5A623" />
              <Text style={styles.unsupportedTitle}>Video yüklenemedi</Text>
            </View>
            <Text style={styles.unsupportedDescription}>
              Doğrudan ve proxy bağlantısı başarısız oldu. Bağlantını kontrol edip tekrar dene.
            </Text>
            <TouchableOpacity
              style={styles.unsupportedButton}
              activeOpacity={0.8}
              onPress={handleRetryLoad}
            >
              <RotateCcw size={16} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.unsupportedButtonText}>Tekrar Dene</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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
    // Alt 150px video timeline şerididir: geri alanı burayı kapsamaz,
    // şerit üstünde başlayan parmak scrub'a gider, çıkış olmaz.
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
