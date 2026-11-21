import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { deleteCachedPosts, getCachedPosts } from '../navigation/postsCache';
import { pushSearchDetail } from '../navigation/rootNavigation';
import { ImageViewerModal } from '../components/ImageViewerModal';
import { StorageService } from '../services/storage';
import { isVideoPost } from '../utils/media';
import { useMediaPlaybackAllowed } from '../context/MediaPlaybackContext';
import { AVAILABLE_SOURCES } from '../services/sources';

type Props = NativeStackScreenProps<RootStackParamList, 'Viewer'>;

/**
 * Shared content viewer: pushed from the Explore / Search / Favorites grids.
 * Swipe-back is the native stack gesture — the real previous screen sits
 * underneath, no fake underlay needed. A search from content pushes a new
 * SearchDetail route, so back returns to content first.
 */
export const ViewerScreen: React.FC<Props> = ({ route, navigation }) => {
  const { postsKey, initialIndex, originTags, originFilter, originSource } = route.params;
  const posts = getCachedPosts(postsKey);
  const isFocused = useIsFocused();
  const mediaAllowed = useMediaPlaybackAllowed();
  const { height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const closingRef = useRef(false);
  const closeRafRef = useRef<number | null>(null);
  useEffect(() => { if (isFocused) closingRef.current = false; }, [isFocused]);

  useEffect(() => {
    return () => {
      if (closeRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(closeRafRef.current);
        closeRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (posts.length === 0 && navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [posts.length, navigation]);

  // Delete the cache entry on close — repeat visits never grow the map.
  useEffect(() => {
    return () => {
      deleteCachedPosts(postsKey);
    };
  }, [postsKey]);

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  // Native stack back gesture works on BOTH photos and videos:
  // on videos, exclude the bottom timeline strip via gestureResponseDistance.bottom
  // and temporarily pause gestureEnabled while actively scrubbing the timeline.
  const currentIsVideo = isVideoPost(posts[currentIndex]);
  useEffect(() => {
    const edgeEnd = 48 + Math.min(insets.left ?? 0, 32);
    const timelineTop = Math.max(200, windowHeight - (insets.bottom ?? 0) - 165);
    navigation.setOptions({
      gestureEnabled: !isScrubbing,
      gestureResponseDistance: currentIsVideo
        ? { end: edgeEnd, bottom: timelineTop }
        : { end: edgeEnd },
    });
  }, [currentIsVideo, isScrubbing, navigation, windowHeight, insets.left, insets.bottom]);

  useEffect(() => {
    if (isFocused && mediaAllowed && posts[currentIndex]) {
      StorageService.addRecentView(posts[currentIndex]);
    }
  }, [currentIndex, posts, isFocused, mediaAllowed]);

  const currentSourceId = posts[currentIndex]?.sourceId;
  const source = originSource?.id === currentSourceId
    ? originSource : AVAILABLE_SOURCES.find((item) => item.id === currentSourceId);
  const handleClose = useCallback((immediate?: boolean) => {
    if (!closingRef.current && navigation.canGoBack()) {
      closingRef.current = true;
      if (immediate) {
        navigation.setOptions({ animation: 'none' });
        if (typeof requestAnimationFrame === 'function') {
          if (closeRafRef.current !== null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(closeRafRef.current);
          }
          closeRafRef.current = requestAnimationFrame(() => {
            closeRafRef.current = null;
            if (navigation.canGoBack()) {
              navigation.goBack();
            }
          });
        } else {
          navigation.goBack();
        }
        return;
      }
      navigation.goBack();
    }
  }, [navigation]);
  const handleTagPress = useCallback((tag: string) => pushSearchDetail([tag], originFilter, source), [originFilter, source]);
  const handleAddTag = useCallback((tag: string) => {
    pushSearchDetail([...(originTags ?? []), tag], originFilter, source);
  }, [originTags, originFilter, source]);
  const handleExcludeTag = useCallback((tag: string) => {
    pushSearchDetail([...(originTags ?? []), tag.startsWith('-') ? tag : `-${tag}`], originFilter, source);
  }, [originTags, originFilter, source]);

  if (posts.length === 0) return null;

  return (
    <ImageViewerModal
      asScreen
      visible
      posts={posts}
      initialIndex={initialIndex}
      onIndexChange={setCurrentIndex}
      onScrubbingChange={setIsScrubbing}
      suspended={!isFocused || !mediaAllowed}
      dismissOnTagPress={false}
      onClose={handleClose}
      onTagPress={handleTagPress}
      onAddTagToSearch={handleAddTag}
      onExcludeTagFromSearch={handleExcludeTag}
    />
  );
};
