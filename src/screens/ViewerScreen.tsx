import React, { useEffect, useState } from 'react';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { deleteCachedPosts, getCachedPosts } from '../navigation/postsCache';
import { pushSearchDetail } from '../navigation/rootNavigation';
import { ImageViewerModal } from '../components/ImageViewerModal';
import { StorageService } from '../services/storage';
import { isVideoPost } from '../utils/media';
import { useMediaPlaybackAllowed } from '../context/MediaPlaybackContext';

type Props = NativeStackScreenProps<RootStackParamList, 'Viewer'>;

/**
 * Paylaşılan içerik görüntüleyici: Keşfet / Arama / Favoriler gridlerinden
 * push edilir. Geri kaydırma native stack gestürüdür — altta gerçek önceki
 * ekran durur, sahte underlay gerekmez. İçerikten yapılan arama yeni bir
 * SearchDetail route'u push'lar, böylece geri önce içeriğe döner.
 */
export const ViewerScreen: React.FC<Props> = ({ route, navigation }) => {
  const { postsKey, initialIndex, originTags, originFilter } = route.params;
  const posts = getCachedPosts(postsKey);
  const isFocused = useIsFocused();
  const mediaAllowed = useMediaPlaybackAllowed();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  useEffect(() => {
    if (posts.length === 0 && navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [posts.length, navigation]);

  // Kapanınca cache girişini sil — gir-çık tekrarında harita şişmez.
  useEffect(() => {
    return () => {
      deleteCachedPosts(postsKey);
    };
  }, [postsKey]);

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex]);

  // Fotoğrafta native geri jesti (eskisi gibi). Videoda native jest kapalı:
  // kenar şeridi timeline'ın üzerine de uzanıp yanlış çıkış yaratıyordu;
  // onun yerine timeline'ı dışlayan özel kenar alanı çalışır.
  const currentIsVideo = isVideoPost(posts[currentIndex]);
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !currentIsVideo });
  }, [currentIsVideo, navigation]);

  useEffect(() => {
    if (posts[currentIndex]) {
      StorageService.addRecentView(posts[currentIndex]);
    }
  }, [currentIndex, posts]);

  if (posts.length === 0) return null;

  const base = originTags ?? [];

  return (
    <ImageViewerModal
      asScreen
      visible
      posts={posts}
      initialIndex={initialIndex}
      onIndexChange={setCurrentIndex}
      suspended={!isFocused || !mediaAllowed}
      dismissOnTagPress={false}
      onClose={() => {
        // Çift dokunma/kaydırma yarışında ikinci goBack boşa düşerdi.
        if (navigation.canGoBack()) {
          navigation.goBack();
        }
      }}
      onTagPress={(tag) => pushSearchDetail([tag], originFilter)}
      onAddTagToSearch={(tag) => pushSearchDetail([...base, tag], originFilter)}
      onExcludeTagFromSearch={(tag) =>
        pushSearchDetail([...base, tag.startsWith('-') ? tag : `-${tag}`], originFilter)
      }
    />
  );
};
