import React from 'react';
import { Dimensions, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEventListener } from 'expo';
import * as Haptics from 'expo-haptics';
import { BookOpen, Heart, Play, Volume2 } from 'lucide-react-native';
import { BooruPost } from '../types/booru';
import { getPostKey } from '../utils/postIdentity';
import { Colors } from '../theme/colors';
import { getMediaHeaders, getMediaUrl, isUnsupportedOnIOS } from '../utils/media';
import { urlEndsWith } from '../utils/guards';
import { proxyService } from '../services/proxyService';
import { GridColumn, useLoadGate } from '../utils/imageLoadGate';
import { trackGridPlayer, recordFreezeEvent } from '../utils/freezeProbe';
import { useGridPreviewsEnabled, markPreviewFailure, isPreviewBlocked, clearPreviewFailure } from '../utils/gridPreviews';
import { getGridPreviewVideoCandidates, getGridPreviewFrames } from '../utils/gridPreviewMedia';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLUMN_WIDTH = (SCREEN_WIDTH - 36) / 2;

interface PostCardProps {
  post: BooruPost;
  onPress: (post: BooruPost) => void;
  showFavoriteBadge?: boolean;
  /** Source-qualified keys from getPostKey; no per-card storage reads. */
  favoriteIds?: Set<string>;
  /** For fair loading across the two ScrollView columns: the gate hands out slots left/right in turn */
  column?: GridColumn;
  /** Only the focused/active card opens video; other cards stay in slide/cover mode */
  videoActive?: boolean;
  /** Is the card on screen? (For the slide/frame loop) */
  onScreen?: boolean;
  /** When tab/stack focus is lost, all media stops, including touch previews. */
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

const isStaticImageCandidate = (u: string | undefined) =>
  isCandidateSafe(u) && !urlEndsWith(u, '.mp4', '.webm', '.mov', '.m4v', '.m3u8', '.mpd', '.zip');

const PostCardComponent: React.FC<PostCardProps> = ({
  post,
  onPress,
  showFavoriteBadge = true,
  favoriteIds,
  column,
  videoActive = false,
  onScreen,
  screenActive = true,
}) => {
  // Image never mounts before the gate opens: both columns share connection slots fairly
  const [canLoad, releaseSlot] = useLoadGate(column);
  // Safety: if the gate opens but onLoadEnd/onError never fires (stuck
  // thumb, empty URI), the slot would stay occupied forever and the queue
  // would stall. Release automatically after 8s; release is idempotent so
  // early release is harmless.
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

  // Static cover stays cheap; automatic motion uses listing clips/samples.
  const primaryRaw = React.useMemo(() => {
    const candidates = [post.previewUrl, post.previewFallbackUrl, post.sampleUrl];
    return candidates.find(isStaticImageCandidate) || candidates.find(isCandidateSafe) || '';
  }, [post.previewUrl, post.previewFallbackUrl, post.sampleUrl]);

  const imageFallbacks = React.useMemo(
    () => Array.from(new Set([post.previewFallbackUrl, post.previewThumbUrl, post.sampleUrl]
      .filter((url): url is string => !!url && url !== primaryRaw && isStaticImageCandidate(url)))),
    [primaryRaw, post.previewFallbackUrl, post.previewThumbUrl, post.sampleUrl]
  );

  const initialUri = React.useMemo(() => getMediaUrl(primaryRaw), [primaryRaw]);
  const [currentUri, setCurrentUri] = React.useState<string>(initialUri);
  const [imageFailed, setImageFailed] = React.useState(false);
  const [touchPreviewActive, setTouchPreviewActive] = React.useState(false);
  const [activeThumbIndex, setActiveThumbIndex] = React.useState(0);

  // Master switch from Settings: when off the card stays on its static cover, no player is set up.
  const previewsEnabled = useGridPreviewsEnabled();
  const autoCandidates = React.useMemo(() => getGridPreviewVideoCandidates(post, Platform.OS),
    [post]);
  const manualCandidates = React.useMemo(() => getGridPreviewVideoCandidates(post, Platform.OS, true),
    [post]);
  const rawFrames = React.useMemo(() => getGridPreviewFrames(post),
    [post.previewThumbs, post.previewThumbUrl, post.sampleUrl, post.previewUrl]);
  const [failedFrames, setFailedFrames] = React.useState<Set<string>>(new Set());
  React.useEffect(() => { setFailedFrames(new Set()); }, [rawFrames, post.id, post.sourceId]);
  const previewThumbs = React.useMemo(() => rawFrames.filter((url) => !failedFrames.has(url)), [rawFrames, failedFrames]);
  const currentFrame = previewThumbs.length ? previewThumbs[activeThumbIndex % previewThumbs.length] : undefined;
  const hasPreview = Boolean(manualCandidates.length || previewThumbs.length);
  // When the card is on screen, a light slide/frame loop (zero native players); only the focused card opens video
  const isCardVisible = onScreen ?? videoActive ?? false;
  const isPreviewActive = previewsEnabled && canLoad && screenActive && onScreen !== false
    && ((isCardVisible && hasPreview) || touchPreviewActive);

  // The slide timer is set up below (once the video path is known).

  // XHamster list HTML gives no static cover on off-screen cards (skeleton);
  // the only cover is a data-previewvideo MP4. expo-image can't show MP4 → black card.
  // With no renderable image but an MP4 available, the cover plays as silent video.
  const hasRenderableImage = React.useMemo(
    () => Boolean(primaryRaw && isStaticImageCandidate(primaryRaw)),
    [primaryRaw]
  );
  const useVideoCover = !hasRenderableImage && manualCandidates.length > 0;

  // One card, one player. When a real preview video exists, it plays
  // (smooth XHamster/XVideos MP4); the slideshow is only the fallback for videoless cards.
  // Even useVideoPlayer(null) creates a native player; the hook lives only in the
  // conditional child below. Off-screen cards hold no player at all.
  const candidates = touchPreviewActive ? manualCandidates : autoCandidates;
  const motionUrl = candidates.find((url) => !isPreviewBlocked(url));
  const [, refreshPreviewState] = React.useState(0);
  const handleMotionError = React.useCallback((_failedUri: string, _proxyAttempted: boolean) => {
    markPreviewFailure(motionUrl);
    refreshPreviewState((value) => value + 1);
    releaseSlot();
  }, [motionUrl, releaseSlot]);
  const showVideo = previewsEnabled && canLoad && screenActive && onScreen !== false
    && (videoActive || touchPreviewActive) && !!motionUrl;
  const [renderedMotionUrl, setRenderedMotionUrl] = React.useState<string>();
  const motionReady = showVideo && renderedMotionUrl === motionUrl;
  React.useEffect(() => {
    if (!showVideo || motionReady || !motionUrl) return;
    // Some native/CDN stalls never emit an error. Do not leave a hidden player
    // buffering forever; keep the cover and advance to the next clip/frame.
    const timer = setTimeout(() => handleMotionError(motionUrl, false), 15_000);
    return () => clearTimeout(timer);
  }, [showVideo, motionReady, motionUrl, handleMotionError]);
  React.useEffect(() => {
    if (!showVideo) setRenderedMotionUrl(undefined);
  }, [showVideo]);
  const handleFirstFrame = React.useCallback(() => {
    clearPreviewFailure(motionUrl);
    setRenderedMotionUrl(motionUrl);
    releaseSlot();
  }, [motionUrl, releaseSlot]);

  React.useEffect(() => {
    // An off-screen video cover must not hold the image queue for 8 seconds.
    if (canLoad && useVideoCover && !showVideo) releaseSlot();
  }, [canLoad, useVideoCover, showVideo, releaseSlot]);

  React.useEffect(() => {
    if (!screenActive || onScreen === false) {
      setTouchPreviewActive(false);
    }
  }, [screenActive, onScreen]);

  React.useEffect(() => {
    // The slide timer doesn't run while the video path is active: it would cause both
    // wasteful re-renders (every 1200ms) and invisible frame changes under the cover.
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
    }, 1200);
    return () => clearInterval(timer);
  }, [isPreviewActive, previewThumbs, showVideo]);

  // At most four image attempts: thumbnail, poster, and one proxy leg each.
  // Video sample URLs must never reach expo-image as error fallbacks.
  const triedUrisRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    triedUrisRef.current = new Set();
    setCurrentUri(getMediaUrl(primaryRaw));
    setImageFailed(false);
  }, [primaryRaw, post.sourceId, post.id]);

  const handleImageError = React.useCallback(() => {
    releaseSlot();
    const tried = triedUrisRef.current;
    if (currentUri) tried.add(currentUri);
    if (tried.size >= 4) { setImageFailed(true); return; }
    const candidates: string[] = [];
    for (const raw of imageFallbacks) {
      const fallbackUrl = getMediaUrl(raw);
      if (fallbackUrl) candidates.push(fallbackUrl);
    }
    // If the direct cover is dead too and a worker is registered, retry via proxy
    if (proxyService.hasWorker()) {
      for (const raw of [primaryRaw, ...imageFallbacks]) {
        if (!isStaticImageCandidate(raw)) continue;
        const viaProxy = getMediaUrl(proxyService.forceProxyUrl(raw));
        if (viaProxy) candidates.push(viaProxy);
      }
    }
    const next = candidates.find((u) => u && !tried.has(u));
    if (next) {
      tried.add(next);
      setCurrentUri(next);
    } else {
      setImageFailed(true);
    }
  }, [imageFallbacks, currentUri, releaseSlot, primaryRaw]);

  // URL keys share cached bytes with prefetch and the viewer sample layer.
  const imageSource = React.useMemo(() => {
    if (!currentUri) return undefined;
    return {
      uri: currentUri,
      headers: getMediaHeaders(currentUri),
    };
  }, [currentUri]);

  // isFav performs no storage read of its own: it comes synchronously from the parent's favoriteIds set.
  // Without a set the badge counts as off (delayed/single reads caused crashes and lag).
  const isFav = showFavoriteBadge && !!favoriteIds && favoriteIds.has(getPostKey(post));

  const ratingColor = React.useMemo(() => getRatingColor(post.rating), [post.rating]);

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={() => {
        setTouchPreviewActive(false);
        onPress(post);
      }}
      delayLongPress={350}
      onLongPress={() => {
        // Normal taps and scrolling must not start downloading full originals.
        if (previewsEnabled && screenActive && onScreen !== false && (hasPreview || useVideoCover)) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          setTouchPreviewActive(true);
        }
      }}
      onPressOut={() => setTouchPreviewActive(false)}
      style={[styles.container, { width: COLUMN_WIDTH, height: cardHeight }]}
    >
      {showVideo && motionUrl ? (
        <CardVideoPreview key={motionUrl} url={motionUrl} onReady={releaseSlot} onFirstFrame={handleFirstFrame} onError={handleMotionError} />
      ) : null}
      {useVideoCover && !motionReady && (
        <View style={styles.videoPlaceholder} pointerEvents="none">
          <Play size={30} color={Colors.dark.textMuted} />
        </View>
      )}
      {canLoad && hasRenderableImage && !useVideoCover && imageSource ? (
        <Image
          source={imageSource}
          style={[styles.image, { opacity: motionReady ? 0 : 1 }]}
          contentFit="cover"
          recyclingKey={`${getPostKey(post)}:${currentUri}`}
          priority="low"
          transition={100}
          cachePolicy="memory-disk"
          allowDownscaling={true}
          onLoadEnd={releaseSlot}
          onError={handleImageError}
        />
      ) : null}
      {imageFailed && !motionReady && (
        <View style={styles.videoPlaceholder} pointerEvents="none">
          <Text style={{ color: Colors.dark.textMuted, fontSize: 12 }}>Cover unavailable</Text>
        </View>
      )}

      {!showVideo && isPreviewActive && currentFrame ? (
        <Image
          source={{
            uri: getMediaUrl(currentFrame) || currentFrame,
            headers: getMediaHeaders(currentFrame),
          }}
          recyclingKey={`frame:${getPostKey(post)}:${currentFrame}`}
          onError={() => setFailedFrames((previous) => new Set([...previous, currentFrame]))}
          onLoadEnd={releaseSlot}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={250}
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

        {/* Audible-clip badge: RedGifs carries hasAudio info as meta 'sound', and
            previews play muted, so the user sees it on the card. */}
        {post.tags.meta?.includes('sound') && (
          <View style={styles.soundBadge}>
            <Volume2 size={10} color="#FFFFFF" />
          </View>
        )}
      </View>

      {/* File type badge if manga/webm/gif/mp4/zip */}
      {post.sourceId === 'nhentai' || (post.pageCount && post.pageCount > 0) ? (
        <View style={styles.mangaBadge}>
          <BookOpen size={10} color="#FFFFFF" style={{ marginRight: 3 }} />
          <Text style={styles.mediaBadgeText}>
            {post.pageCount ? `${post.pageCount}P` : 'MANGA'}
          </Text>
        </View>
      ) : isWebm ? (
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
  onFirstFrame: () => void;
  onError: (failedUri: string, proxyAttempted: boolean) => void;
}> = React.memo(({ url, onReady, onFirstFrame, onError }) => {
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

  // Mandatory native teardown: when the card leaves the screen or unmounts,
  // release the AVPlayer and the com.apple.avplayer.systemMuteObserver threads immediately.
  // Waiting on Hermes GC let 400+ players pile up and caused 0x8BADF00D hangs.
  React.useEffect(() => {
    return () => {
      try {
        player.pause();
        (player as { release?: () => void }).release?.();
      } catch (e) {
        // Silently pass if already released
      }
    };
  }, [player]);

  // One-shot selective proxy fallback on TLS drop (this preview only).
  const proxyTriedRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEventListener(player, 'statusChange', (payload) => {
    if (!mountedRef.current) return;
    if (payload.status === 'readyToPlay') { player.play(); onReady(); }
    if (payload.status !== 'error') return;
    recordFreezeEvent('grid-player-error');
    const currentUri = videoSource.uri;
    // Each clip gets at most one proxy leg before falling back to another candidate/frame.
    const viaProxyLeg = proxyTriedRef.current || proxyService.isProxiedUrl(currentUri);
    if (viaProxyLeg || !proxyService.hasWorker()) {
      onError(currentUri, viaProxyLeg);
      return;
    }
    proxyTriedRef.current = true;
    const viaProxy = proxyService.forceProxyUrl(url);
    if (!viaProxy || viaProxy === currentUri) {
      onError(currentUri, true);
      return;
    }
    player.replaceAsync({ uri: getMediaUrl(viaProxy) || viaProxy, headers: getMediaHeaders(viaProxy) })
      .catch(() => { if (mountedRef.current) onError(currentUri, true); });
  });

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      surfaceType="textureView"
      useExoShutter={false}
      onFirstFrameRender={() => { if (mountedRef.current) onFirstFrame(); }}
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
    if (prevProps.onScreen !== nextProps.onScreen) return false;
    if ((prevProps.screenActive ?? true) !== (nextProps.screenActive ?? true)) return false;

    const prevFav =
      (prevProps.showFavoriteBadge ?? true) &&
      !!prevProps.favoriteIds &&
      prevProps.favoriteIds.has(getPostKey(prevProps.post));
    const nextFav =
      (nextProps.showFavoriteBadge ?? true) &&
      !!nextProps.favoriteIds &&
      nextProps.favoriteIds.has(getPostKey(nextProps.post));

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
  mangaBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(237, 37, 83, 0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
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
