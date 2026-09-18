import React from 'react';
import { Dimensions, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Heart } from 'lucide-react-native';
import { BooruPost } from '../types/booru';
import { Colors } from '../theme/colors';
import { getMediaHeaders, getMediaUrl, isUnsupportedOnIOS } from '../utils/media';
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
}) => {
  // Kapı açılmadan resim mount olmaz: iki sütun bağlantı slotlarını adil paylaşır
  const [canLoad, releaseSlot] = useLoadGate(column);
  // Clamp aspect ratio between 0.6 and 1.4 for balanced masonry presentation
  const safeAspectRatio = Math.max(0.6, Math.min(1.4, post.aspectRatio || 0.75));
  const cardHeight = COLUMN_WIDTH / safeAspectRatio;

  const isWebm = React.useMemo(
    () =>
      post.fileExt?.toLowerCase() === 'webm' ||
      Boolean(post.originalUrl && post.originalUrl.split('?')[0].toLowerCase().endsWith('.webm')) ||
      Boolean(post.sampleUrl && post.sampleUrl.split('?')[0].toLowerCase().endsWith('.webm')),
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

  React.useEffect(() => {
    setCurrentUri(getMediaUrl(primaryRaw));
  }, [primaryRaw]);

  const handleImageError = React.useCallback(() => {
    releaseSlot();
    if (!fallbackRaw) return;
    const fallbackUrl = getMediaUrl(fallbackRaw);
    if (fallbackUrl && fallbackUrl !== currentUri) {
      setCurrentUri(fallbackUrl);
    }
  }, [fallbackRaw, currentUri, releaseSlot]);

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
      style={[styles.container, { width: COLUMN_WIDTH, height: cardHeight }]}
    >
      {canLoad && imageSource ? (
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

export const PostCard = React.memo<PostCardProps>(
  PostCardComponent,
  (prevProps, nextProps) => {
    if (prevProps.post.id !== nextProps.post.id) return false;
    if (prevProps.post !== nextProps.post) return false;
    if (prevProps.showFavoriteBadge !== nextProps.showFavoriteBadge) return false;
    if (prevProps.onPress !== nextProps.onPress) return false;
    if (prevProps.column !== nextProps.column) return false;

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
