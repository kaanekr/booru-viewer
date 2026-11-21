import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const closingRef = useRef(false);
  useEffect(() => { if (isFocused) closingRef.current = false; }, [isFocused]);

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

  // Native back gesture for photos (as before). Disabled for videos:
  // the edge strip also overlapped the timeline and caused accidental exits;
  // a dedicated edge area excluding the timeline is used instead.
  const currentIsVideo = isVideoPost(posts[currentIndex]);
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !currentIsVideo });
  }, [currentIsVideo, navigation]);

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
          requestAnimationFrame(() => navigation.goBack());
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
      suspended={!isFocused || !mediaAllowed}
      dismissOnTagPress={false}
      onClose={handleClose}
      onTagPress={handleTagPress}
      onAddTagToSearch={handleAddTag}
      onExcludeTagFromSearch={handleExcludeTag}
    />
  );
};
