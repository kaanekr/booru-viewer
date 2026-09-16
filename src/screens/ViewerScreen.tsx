import React, { useEffect } from 'react';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/types';
import { getCachedPosts } from '../navigation/postsCache';
import { pushSearchDetail } from '../navigation/rootNavigation';
import { ImageViewerModal } from '../components/ImageViewerModal';

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

  useEffect(() => {
    if (posts.length === 0) {
      navigation.goBack();
    }
  }, [posts.length, navigation]);

  if (posts.length === 0) return null;

  const base = originTags ?? [];

  return (
    <ImageViewerModal
      asScreen
      visible
      posts={posts}
      initialIndex={initialIndex}
      suspended={!isFocused}
      dismissOnTagPress={false}
      onClose={() => navigation.goBack()}
      onTagPress={(tag) => pushSearchDetail([tag], originFilter)}
      onAddTagToSearch={(tag) => pushSearchDetail([...base, tag], originFilter)}
      onExcludeTagFromSearch={(tag) =>
        pushSearchDetail([...base, tag.startsWith('-') ? tag : `-${tag}`], originFilter)
      }
    />
  );
};
