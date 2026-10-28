import React, { useMemo } from 'react';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { SearchScreen } from './SearchScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'SearchDetail'>;

/**
 * Search result opened in a chain from content/grid: pushed onto the stack,
 * going back returns to the previous content (or grid). No fake history.
 */
export const SearchDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { tags, baseFilter, source } = route.params;
  const [clearedTag, setClearedTag] = React.useState(false);

  const initialFilter = useMemo(() => {
    return baseFilter
      ? { ...baseFilter, tags, jumpToPage: 1 }
      : undefined;
  }, [baseFilter, tags]);

  return (
    <SearchScreen
      activeSource={source}
      initialTag={clearedTag ? undefined : tags.join(' ')}
      initialMode="replace"
      initialFilter={clearedTag ? undefined : initialFilter}
      onClearInitialTag={() => setClearedTag(true)}
      onBackPress={() => {
        if (navigation.canGoBack()) {
          navigation.goBack();
        }
      }}
    />
  );
};
