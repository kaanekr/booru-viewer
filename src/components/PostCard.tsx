import React from 'react';
import { Dimensions, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import { Heart } from 'lucide-react-native';
import { BooruPost } from '../types/booru';
import { Colors } from '../theme/colors';
import { getMediaHeaders, getMediaUrl, isUnsupportedOnIOS } from '../utils/media';
import { urlEndsWith } from '../utils/guards';
import { proxyService } from '../services/proxyService';
import { GridColumn, useLoadGate } from '../utils/imageLoadGate';

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
  // iOS AVPlayer WebM açamaz (PH mediabook .webm): oynatıcıya verilirse
  // siyah kart + AVFoundation "Cannot Open" uyarıları. iOS'ta WebM
  // önizleme yok sayılır, kapak/slayt fallback'i devreye girer.
  const playablePreviewUrl =
    previewVideoUrl && !(Platform.OS === 'ios' && isUnsupportedOnIOS(previewVideoUrl))
      ? previewVideoUrl
      : undefined;
  const previewThumbs = post.previewThumbs;
  const secondaryThumb = post.previewThumbUrl;

  const hasPreview = Boolean(playablePreviewUrl || (previewThumbs && previewThumbs.length > 0) || secondaryThumb);
  // Kart ekrandaysa (videoActive) veya kullanıcı karta dokunuyorsa önizleme aktif
  const isPreviewActive = (videoActive && hasPreview) || touchPreviewActive;

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
  React.useEffect(() => {
    if (!isPreviewActive || !previewThumbs || previewThumbs.length <= 1) {
      setActiveThumbIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setActiveThumbIndex((prev) => (prev + 1) % previewThumbs.length);
    }, 500);
    return () => clearInterval(timer);
  }, [isPreviewActive, previewThumbs]);

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

  const videoCoverSource = React.useMemo(() => {
    // Kaynak kapı açılana kadar null: ~50 oyuncu aynı anda yüklenmeye
    // hücum edip ilk kartları boğuyordu. Kapı (6 slot) yüklemeyi seriye bağlar.
    if (!videoCoverRaw || !canLoad) return null;
    const url = getMediaUrl(videoCoverRaw);
    if (!url) return null;
    return { uri: url, headers: getMediaHeaders(url) };
  }, [videoCoverRaw, canLoad]);

  const videoPlayer = useVideoPlayer(videoCoverSource, (p) => {
    p.loop = true;
    p.muted = true;
    // Otomatik oynatma YOK: videoActive + readyToPlay birlikte karar verir.
  });
  // Kapak hazır olunca (ilk kare) kapı slotunu bırak (8sn emniyeti zaten var).
  // Hazır olma anında kart görünürse oynat: ilk ekrandaki kartlarda play()
  // çağrısı oyuncu yüklenmeden boşa gidebildiği için burada tekrar deniyoruz.
  const videoActiveRef = React.useRef(videoActive);
  videoActiveRef.current = videoActive;
  const useVideoCoverRef = React.useRef(useVideoCover);
  useVideoCoverRef.current = useVideoCover;
  const videoSourceRef = React.useRef(videoCoverSource);
  videoSourceRef.current = videoCoverSource;
  const thumbRetryRef = React.useRef(0);
  const thumbProxyTriedRef = React.useRef(false);
  // Unmount sonrası ölü oyuncuya replace() çağrılmasın diye bekleyen
  // retry zamanlayıcıları takip edilir ve temizlenir.
  const thumbTimersRef = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  React.useEffect(() => {
    thumbRetryRef.current = 0;
    thumbProxyTriedRef.current = false;
  }, [videoCoverSource]);
  React.useEffect(() => {
    const timers = thumbTimersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
    };
  }, []);
  useEventListener(videoPlayer, 'statusChange', (payload) => {
    if (payload.status === 'readyToPlay') {
      releaseSlot();
      if (videoActiveRef.current && useVideoCoverRef.current) {
        try {
          videoPlayer.play();
        } catch {}
      }
    } else if (payload.status === 'error') {
      // Hücum anında düşen kapak: slotu bırak, gecikmeyle en fazla 2 kez dene
      releaseSlot();
      const src = videoSourceRef.current;
      if (!src) return;
      // TLS düşüşü (örn. api-cdn-mp4.rule34.xxx): ilk hatada tek seferlik
      // seçici proxy dene, diğer kartlar doğrudan kalır.
      if (!thumbProxyTriedRef.current && proxyService.hasWorker() && !proxyService.isProxiedUrl(src.uri)) {
        thumbProxyTriedRef.current = true;
        const raw = videoCoverRaw;
        const viaProxy = raw ? proxyService.forceProxyUrl(raw) : '';
        if (viaProxy) {
          const proxiedSrc = { uri: getMediaUrl(viaProxy) || viaProxy, headers: getMediaHeaders(viaProxy) };
          videoSourceRef.current = proxiedSrc as typeof src;
          thumbTimersRef.current.push(
            setTimeout(() => {
              try {
                videoPlayer.replace(proxiedSrc);
              } catch {}
            }, 800)
          );
          return;
        }
      }
      if (thumbRetryRef.current < 2) {
        thumbRetryRef.current += 1;
        const delay = 1500 * thumbRetryRef.current;
        thumbTimersRef.current.push(
          setTimeout(() => {
            try {
              const current = videoSourceRef.current;
              if (current) videoPlayer.replace(current);
            } catch {}
          }, delay)
        );
      }
    }
  });
  useEventListener(videoPlayer, 'playingChange', (payload) => {
    if (payload.isPlaying) releaseSlot();
  });

  // Sadece ekrandaki video kapak oynar: ebeveyn videoActive'i görünürlüğe
  // göre sürer. Resim kartlarda etkisiz.
  React.useEffect(() => {
    if (!useVideoCover) return;
    try {
      if (videoActive) {
        videoPlayer.play();
      } else {
        videoPlayer.pause();
      }
    } catch {}
  }, [videoActive, useVideoCover, videoPlayer]);

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
        if (hasPreview) {
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
      {canLoad && useVideoCover ? (
        <VideoView
          player={videoPlayer}
          style={styles.image}
          contentFit="cover"
          nativeControls={false}
          allowsPictureInPicture={false}
          fullscreenOptions={{ enable: false }}
        />
      ) : canLoad && imageSource ? (
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

      {isPreviewActive && playablePreviewUrl ? (
        <CardVideoPreview url={playablePreviewUrl} />
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

const CardVideoPreview: React.FC<{ url: string }> = React.memo(({ url }) => {
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
    p.play();
  });

  // TLS düşüşünde tek seferlik seçici proxy fallback'i (sadece bu önizleme).
  const proxyTriedRef = React.useRef(false);
  React.useEffect(() => {
    proxyTriedRef.current = false;
  }, [url]);
  useEventListener(player, 'statusChange', (payload) => {
    if (payload.status !== 'error' || proxyTriedRef.current) return;
    const currentUri = videoSource.uri;
    if (!proxyService.hasWorker() || proxyService.isProxiedUrl(currentUri)) return;
    proxyTriedRef.current = true;
    const viaProxy = proxyService.forceProxyUrl(url);
    if (!viaProxy || viaProxy === currentUri) return;
    try {
      player.replace({ uri: getMediaUrl(viaProxy) || viaProxy, headers: getMediaHeaders(viaProxy) });
    } catch {}
  });

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
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
