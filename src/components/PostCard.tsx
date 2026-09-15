import React from 'react';
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { BooruPost } from '../types/booru';
import { Colors } from '../theme/colors';
import { getMediaHeaders, getMediaUrl } from '../utils/media';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLUMN_WIDTH = (SCREEN_WIDTH - 36) / 2;

interface PostCardProps {
  post: BooruPost;
  onPress: (post: BooruPost) => void;
}

export const PostCard: React.FC<PostCardProps> = ({ post, onPress }) => {
  // Clamp aspect ratio between 0.6 and 1.4 for balanced masonry presentation
  const safeAspectRatio = Math.max(0.6, Math.min(1.4, post.aspectRatio || 0.75));
  const cardHeight = COLUMN_WIDTH / safeAspectRatio;

  const getRatingColor = (rating: string) => {
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

  const primaryRaw = post.previewUrl || post.sampleUrl || post.originalUrl;
  const fallbackRaw = post.sampleUrl || post.originalUrl || post.previewUrl;
  const [currentUri, setCurrentUri] = React.useState<string>(getMediaUrl(primaryRaw));

  React.useEffect(() => {
    setCurrentUri(getMediaUrl(post.previewUrl || post.sampleUrl || post.originalUrl));
  }, [post.previewUrl, post.sampleUrl, post.originalUrl]);

  const handleImageError = () => {
    const fallbackUrl = getMediaUrl(fallbackRaw);
    if (fallbackUrl && fallbackUrl !== currentUri) {
      setCurrentUri(fallbackUrl);
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={() => onPress(post)}
      style={[styles.container, { width: COLUMN_WIDTH, height: cardHeight }]}
    >
      <Image
        source={{
          uri: currentUri,
          headers: getMediaHeaders(currentUri),
        }}
        style={styles.image}
        contentFit="cover"
        recyclingKey={post.id}
        priority="normal"
        transition={120}
        cachePolicy="memory-disk"
        onError={handleImageError}
      />

      <View style={styles.gradientOverlay} />

      {/* Badges container */}
      <View style={styles.badgeContainer}>
        {post.rating && (
          <View
            style={[
              styles.ratingBadge,
              { backgroundColor: getRatingColor(post.rating) },
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

      {/* File type badge if webm/gif */}
      {post.fileExt && ['gif', 'mp4', 'webm', 'zip'].includes(post.fileExt.toLowerCase()) && (
        <View style={styles.mediaBadge}>
          <Text style={styles.mediaBadgeText}>{post.fileExt.toUpperCase()}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

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
  mediaBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
});
