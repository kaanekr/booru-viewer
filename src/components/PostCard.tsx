import React from 'react';
import { Dimensions, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import { Heart, Play, Volume2 } from 'lucide-react-native';
import { BooruPost } from '../types/booru';
import { Colors } from '../theme/colors';
import { getMediaHeaders, getMediaUrl, isUnsupportedOnIOS } from '../utils/media';
import { urlEndsWith } from '../utils/guards';
import { proxyService } from '../services/proxyService';
import { GridColumn, useLoadGate } from '../utils/imageLoadGate';
import { trackGridPlayer, recordFreezeEvent } from '../utils/freezeProbe';
import { useGridPreviewsEnabled } from '../utils/gridPreviews';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLUMN_WIDTH = (SCREEN_WIDTH - 36) / 2;

interface PostCardProps {
  post: BooruPost;
  onPress: (post: BooruPost) => void;
  showFavoriteBadge?: boolean;
  /** Üst ekran fav ID setini verdiyse kart storage'a sormaz — anında rozet, çökme yok */
  favoriteIds?: Set<string>;
  /** ScrollView iki sütunda adil yükleme için: kapı sol/sağ sırayla slot dağıtır */
  column?: GridColumn;
  /** Görünürlük kancasından: true ise video kapak oynar, false ise durur */
  videoActive?: boolean;
  /** Sekme/stack odağı kaybolunca dokunma önizlemesi dahil tüm medya durur. */
  screenActive?: boolean;
}

const getRatingColor = (rating: string | undefined) => {
  switch (rating?.toLowerCase()) {
    case 's':
    case 'g':
      return Colors.dark.safe;
    case 'q':
      return Colors.dark.warning;
    case 'e':
      return Colors.dark.danger;
    default:
      return Colors.dark.textMuted;
  }
};

// Priority: previewUrl first to ensure safe image thumbnail (no webm passed to expo-image on iOS)
const isCandidateSafe = (u: string | undefined) => {
  if (!u) return false;
  if (Platform.OS === 'ios' && isUnsupportedOnIOS(u)) return false;
  return true;
};

const PostCardComponent: React.FC<PostCardProps> = ({
  post,
  onPress,
  showFavoriteBadge = true,
  favoriteIds,
  column,
  videoActive = false,
  screenActive = true,
}) => {
  // Kapı açılmadan resim mount olmaz: iki sütun bağlantı slotlarını adil paylaşır
  const [canLoad, releaseSlot] = useLoadGate(column);
  // Emniyet: kapı açılıp da onLoadEnd/onError hiç ateşlenmezse (takılan
  // thumb, boş URI) slot sonsuza dek dolu kalır ve kuyruk kararır. 8sn'de
  // otomatik bırak; release idempotent olduğu için erken bırakma zararsız.
  React.useEffect(() => {
    if (!canLoad) return;
    const t = setTimeout(releaseSlot, 8000);
    return () => clearTimeout(t);
  }, [canLoad, releaseSlot]);
  // Clamp aspect ratio between 0.6 and 1.4 for balanced masonry presentation
  const safeAspectRatio = Math.max(0.6, Math.min(1.4, post.aspectRatio || 0.75));
  const cardHeight = COLUMN_WIDTH / safeAspectRatio;

  const isWebm = React.useMemo(
    () =>
      (typeof post.fileExt === 'string' && post.fileExt.toLowerCase() === 'webm') ||
      urlEndsWith(post.originalUrl, '.webm') ||
      urlEndsWith(post.sampleUrl, '.webm'),
    [post.fileExt, post.originalUrl, post.sampleUrl]
  );

  // Grid strictly uses preview thumbnail; full is exclusively owned by the viewer
  const primaryRaw = React.useMemo(
    () =>
      (isCandidateSafe(post.previewUrl) ? post.previewUrl : undefined) ||
      (isCandidateSafe(post.sampleUrl) ? post.sampleUrl : undefined) ||
      post.previewUrl ||
      '',
    [post.previewUrl, post.sampleUrl]
  );

  const fallbackRaw = React.useMemo(
    () =>
      (primaryRaw !== post.sampleUrl && isCandidateSafe(post.sampleUrl) ? post.sampleUrl : undefined) ||
      '',
    [primaryRaw, post.sampleUrl]
  );

  const initialUri = React.useMemo(() => getMediaUrl(primaryRaw), [primaryRaw]);
  const [currentUri, setCurrentUri] = React.useState<string>(initialUri);
  const [touchPreviewActive, setTouchPreviewActive] = React.useState(false);
  const [activeThumbIndex, setActiveThumbIndex] = React.useState(0);

  const previewVideoUrl = post.previewVideoUrl;
  // Ayarlar'daki anahtar: kapalıysa kart statik kapakta kalır, oyuncu kurulmaz.
  const previewsEnabled = useGridPreviewsEnabled();
  // iOS AVPlayer WebM açamaz (PH mediabook .webm): oynatıcıya verilirse
  // siyah kart + AVFoundation "Cannot Open" uyarıları. iOS'ta WebM
  // önizleme yok sayılır, kapak/slayt fallback'i devreye girer.
  const playablePreviewUrl =
    previewVideoUrl &&
    !urlEndsWith(previewVideoUrl, '.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif') &&
    !(Platform.OS === 'ios' && isUnsupportedOnIOS(previewVideoUrl))
      ? previewVideoUrl
      : undefined;
  const previewThumbs = post.previewThumbs;
  const secondaryThumb = post.previewThumbUrl;

  const hasPreview = Boolean(playablePreviewUrl || (previewThumbs && previewThumbs.length > 0) || secondaryThumb);
  // Kart ekrandaysa (videoActive) veya kullanıcı karta dokunuyorsa önizleme aktif
  const isPreviewActive = previewsEnabled && screenActive && ((videoActive && hasPreview) || touchPreviewActive);

  const touchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePreviewTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTouchTimer = () => {
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
  };
  const clearActivePreviewTimer = () => {
    if (activePreviewTimerRef.current) {
      clearTimeout(activePreviewTimerRef.current);
      activePreviewTimerRef.current = null;
    }
  };

  React.useEffect(() => {
    return () => {
      clearTouchTimer();
      clearActivePreviewTimer();
    };
  }, []);
  // Slayt zamanlayıcısı aşağıda (video yolu belli olduktan sonra) kurulur.

  // XHamster liste HTML'i ekran-dışı kartlarda statik kapak vermez (skeleton);
  // tek kapak data-previewvideo MP4'tür. expo-image MP4 gösteremez → siyah kart.
  // Görüntülenebilir resim yok ama MP4 varsa kapak sessiz video olarak oynar.
  const isMp4Url = React.useCallback(
    (u: unknown) => typeof u === 'string' && !!u && /\.mp4($|\?)/i.test(u.split('?')[0]),
    []
  );
  const hasRenderableImage = React.useMemo(
    () => Boolean(primaryRaw && !isMp4Url(primaryRaw)),
    [primaryRaw, isMp4Url]
  );
  const videoCoverRaw = React.useMemo(() => {
    if (hasRenderableImage) return '';
    const cands = [post.previewUrl, post.sampleUrl, post.originalUrl];
    for (const u of cands) {
      if (isMp4Url(u)) return u as string;
    }
    return '';
  }, [hasRenderableImage, post.previewUrl, post.sampleUrl, post.originalUrl, isMp4Url]);
  const useVideoCover = Boolean(videoCoverRaw);

  // Tek kart, tek oynatıcı. Gerçek önizleme videosu varsa o oynar
  // (XHamster/XVideos akıcı MP4); slayt yalnız videosuz kartın fallback'i.
  // useVideoPlayer(null) bile native oyuncu oluşturur; kanca yalnız aşağıdaki
  // koşullu çocukta bulunur. Görünmeyen kart hiçbir oyuncu tutmaz.
  const motionUrl = useVideoCover ? videoCoverRaw : playablePreviewUrl;
  const [failedMotionUrl, setFailedMotionUrl] = React.useState<string>();
  const handleMotionError = React.useCallback(() => {
    setFailedMotionUrl(motionUrl);
    releaseSlot();
  }, [motionUrl, releaseSlot]);
  const showVideo = previewsEnabled && canLoad && screenActive && (videoActive || touchPreviewActive)
    && !!motionUrl && motionUrl !== failedMotionUrl;

  React.useEffect(() => {
    // Ekran dışındaki video kapağı resim kuyruğunu 8 saniye tutmasın.
    if (canLoad && useVideoCover && !showVideo) releaseSlot();
  }, [canLoad, useVideoCover, showVideo, releaseSlot]);

  React.useEffect(() => {
    if (!screenActive) {
      clearTouchTimer();
      clearActivePreviewTimer();
      setTouchPreviewActive(false);
    }
  }, [screenActive]);

  React.useEffect(() => {
    // Video yolu aktifken slayt zamanlayıcısı çalışmaz: hem gereksiz
    // re-render (500ms'de bir) hem de kapak altında görünmez kare değişimi olurdu.
    if (showVideo) {
      setActiveThumbIndex(0);
      return;
    }
    if (!isPreviewActive || !previewThumbs || previewThumbs.length <= 1) {
      setActiveThumbIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setActiveThumbIndex((prev) => (prev + 1) % previewThumbs.length);
    }, 500);
    return () => clearInterval(timer);
  }, [isPreviewActive, previewThumbs, showVideo]);

  // onError ping-pong koruması: denenmiş URI'ler tekrar denenmez, en fazla
  // 3 farklı URI (direkt + fallback + proxy). primaryRaw değişince sıfırlanır.
  const triedUrisRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    triedUrisRef.current = new Set();
    setCurrentUri(getMediaUrl(primaryRaw));
  }, [primaryRaw]);

  const handleImageError = React.useCallback(() => {
    releaseSlot();
    const tried = triedUrisRef.current;
    if (currentUri) tried.add(currentUri);
    if (tried.size > 3) return;
    const candidates: string[] = [];
    if (fallbackRaw) {
      const fallbackUrl = getMediaUrl(fallbackRaw);
      if (fallbackUrl) candidates.push(fallbackUrl);
    }
    // Direkt kapak da öldüyse ve worker kayıtlıysa proxy üzerinden tekrar dene
    if (proxyService.hasWorker()) {
      const raw = primaryRaw || post.previewUrl || '';
      const viaProxy = raw ? getMediaUrl(proxyService.forceProxyUrl(raw)) : '';
      if (viaProxy) candidates.push(viaProxy);
    }
    const next = candidates.find((u) => u && !tried.has(u));
    if (next) {
      tried.add(next);
      setCurrentUri(next);
    }
  }, [fallbackRaw, currentUri, releaseSlot, primaryRaw, post.previewUrl]);

  // Grid, URL'yi cache key olarak kullanır (özel suffix YOK): prefetch
  // ile aynı entry'ye yazılır/okunur. Viewer'ın :sample/:full-original
  // key'leri ayrı kalır, çapraz kirlenme olmaz.
  const imageSource = React.useMemo(() => {
    if (!currentUri) return undefined;
    return {
      uri: currentUri,
      headers: getMediaHeaders(currentUri),
    };
  }, [currentUri]);

  // isFav kartın kendi storage okuması YOK: üst ekran favoriteIds setinden senkron gelir.
  // Set yoksa rozet kapalı sayılır (gecikmeli/tekil okuma çökme ve gecikme yapıyordu).
  const isFav = showFavoriteBadge && !!favoriteIds && favoriteIds.has(post.id);

  const ratingColor = React.useMemo(() => getRatingColor(post.rating), [post.rating]);

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={() => onPress(post)}
      delayPressIn={0}
      pressRetentionOffset={{ top: 200, bottom: 200, left: 100, right: 100 }}
      onPressIn={() => {
        if (previewsEnabled && screenActive && (hasPreview || useVideoCover)) {
          clearTouchTimer();
          clearActivePreviewTimer();
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          setTouchPreviewActive(true);
        }
      }}
      onPressOut={() => {
        clearTouchTimer();
        clearActivePreviewTimer();
        activePreviewTimerRef.current = setTimeout(() => {
          setTouchPreviewActive(false);
        }, 1200);
      }}
      style={[styles.container, { width: COLUMN_WIDTH, height: cardHeight }]}
    >
      {useVideoCover && !showVideo && (
        <View style={styles.videoPlaceholder} pointerEvents="none">
          <Play size={30} color={Colors.dark.textMuted} />
        </View>
      )}
      {canLoad && !useVideoCover && imageSource ? (
        <Image
          source={imageSource}
          style={styles.image}
          contentFit="cover"
          recyclingKey={post.id}
          priority="low"
          transition={100}
          cachePolicy="memory-disk"
          allowDownscaling={true}
          onLoadEnd={releaseSlot}
          onError={handleImageError}
        />
      ) : null}

      {showVideo && motionUrl ? (
        <CardVideoPreview key={motionUrl} url={motionUrl} onReady={releaseSlot} onError={handleMotionError} />
      ) : isPreviewActive && previewThumbs && previewThumbs.length > 0 ? (
        <Image
          source={{
            uri: getMediaUrl(previewThumbs[activeThumbIndex]) || previewThumbs[activeThumbIndex],
            headers: getMediaHeaders(previewThumbs[activeThumbIndex]),
          }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={100}
        />
      ) : isPreviewActive && secondaryThumb ? (
        <Image
          source={{
            uri: getMediaUrl(secondaryThumb) || secondaryThumb,
            headers: getMediaHeaders(secondaryThumb),
          }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
        />
      ) : null}

      <View style={styles.gradientOverlay} />

      {/* Badges container */}
      <View style={styles.badgeContainer}>
        {post.rating && (
          <View
            style={[
              styles.ratingBadge,
              { backgroundColor: ratingColor },
            ]}
          >
            <Text style={styles.ratingText}>
              {post.rating.toUpperCase()}
            </Text>
          </View>
        )}

        {post.score !== undefined && post.score !== 0 && (
          <View style={styles.scoreBadge}>
            <Text style={styles.scoreText}>★ {post.score}</Text>
          </View>
        )}

        {/* Sesli klip rozeti: RedGifs hasAudio bilgisini meta 'sound' olarak taşır,
            önizlemeler sessiz oynadığı için kullanıcı bunu karttan görsün. */}
        {post.tags.meta?.includes('sound') && (
          <View style={styles.soundBadge}>
            <Volume2 size={10} color="#FFFFFF" />
          </View>
        )}
      </View>

      {/* File type badge if webm/gif/mp4/zip */}
      {isWebm ? (
        <View style={[styles.mediaBadge, Platform.OS === 'ios' ? styles.mediaBadgeUnsupported : styles.mediaBadgeWebm]}>
          <Text style={styles.mediaBadgeText}>WEBM</Text>
        </View>
      ) : post.fileExt && ['gif', 'mp4', 'zip'].includes(post.fileExt.toLowerCase()) ? (
        <View style={styles.mediaBadge}>
          <Text style={styles.mediaBadgeText}>{post.fileExt.toUpperCase()}</Text>
        </View>
      ) : null}

      {/* Favorite badge (top-left heart) */}
      {isFav && (
        <View style={styles.favBadge} pointerEvents="none">
          <Heart size={13} color="#FFFFFF" fill="#FF4D4F" />
        </View>
      )}
    </TouchableOpacity>
  );
};

const CardVideoPreview: React.FC<{
  url: string;
  onReady: () => void;
  onError: () => void;
}> = React.memo(({ url, onReady, onError }) => {
  React.useEffect(() => trackGridPlayer(), []);
  const videoSource = React.useMemo(
    () => ({
      uri: getMediaUrl(url) || url,
      headers: getMediaHeaders(url),
    }),
    [url]
  );

  const player = useVideoPlayer(videoSource, (p) => {
    p.loop = true;
    p.muted = true;
    p.audioMixingMode = 'mixWithOthers';
    p.play();
  });

  // Zorunlu native imha: kart ekrandan çıktığında veya unmount olduğunda
  // AVPlayer'ı ve com.apple.avplayer.systemMuteObserver thread'lerini anında serbest bırak.
  // Hermes GC'nin keyfini beklemek 400+ oyuncu birikmesine ve 0x8BADF00D kilitlenmesine yol açıyordu.
  React.useEffect(() => {
    return () => {
      try {
        player.pause();
        (player as { release?: () => void }).release?.();
      } catch (e) {
        // Zaten serbest bırakılmışsa sessizce geç
      }
    };
  }, [player]);

  // TLS düşüşünde tek seferlik seçici proxy fallback'i (sadece bu önizleme).
  const proxyTriedRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEventListener(player, 'statusChange', (payload) => {
    if (payload.status === 'readyToPlay') onReady();
    if (payload.status !== 'error') return;
    recordFreezeEvent('grid-player-error');
    const currentUri = videoSource.uri;
    if (proxyTriedRef.current || !proxyService.hasWorker() || proxyService.isProxiedUrl(currentUri)) {
      onError();
      return;
    }
    proxyTriedRef.current = true;
    const viaProxy = proxyService.forceProxyUrl(url);
    if (!viaProxy || viaProxy === currentUri) {
      onError();
      return;
    }
    player.replaceAsync({ uri: getMediaUrl(viaProxy) || viaProxy, headers: getMediaHeaders(viaProxy) })
      .catch(() => { if (mountedRef.current) onError(); });
  });

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      allowsVideoFrameAnalysis={false}
      allowsPictureInPicture={false}
      fullscreenOptions={{ enable: false }}
      pointerEvents="none"
    />
  );
});

export const PostCard = React.memo<PostCardProps>(
  PostCardComponent,
  (prevProps, nextProps) => {
    if (prevProps.post.id !== nextProps.post.id) return false;
    if (prevProps.post !== nextProps.post) return false;
    if (prevProps.showFavoriteBadge !== nextProps.showFavoriteBadge) return false;
    if (prevProps.onPress !== nextProps.onPress) return false;
    if (prevProps.column !== nextProps.column) return false;
    if ((prevProps.videoActive ?? false) !== (nextProps.videoActive ?? false)) return false;
    if ((prevProps.screenActive ?? true) !== (nextProps.screenActive ?? true)) return false;

    const prevFav =
      (prevProps.showFavoriteBadge ?? true) &&
      !!prevProps.favoriteIds &&
      prevProps.favoriteIds.has(prevProps.post.id);
    const nextFav =
      (nextProps.showFavoriteBadge ?? true) &&
      !!nextProps.favoriteIds &&
      nextProps.favoriteIds.has(nextProps.post.id);

    if (prevFav !== nextFav) return false;

    return true;
  }
);

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: Colors.dark.card,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.dark.cardBorder,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  videoPlaceholder: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradientOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  badgeContainer: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ratingBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  ratingText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  soundBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  scoreBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  scoreText: {
    color: '#FFD700',
    fontSize: 10,
    fontWeight: '700',
  },
  mediaBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  mediaBadgeWebm: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
  },
  mediaBadgeUnsupported: {
    backgroundColor: 'rgba(230, 81, 0, 0.9)',
  },
  mediaBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  favBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
