import React, { useMemo } from 'react';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { useSource } from '../context/SourceContext';
import { SearchScreen } from './SearchScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'SearchDetail'>;

/**
 * İçerikten / gridden zincirleme açılan arama sonucu: stack'e push edilir,
 * geri gidince bir önceki içeriğe (veya gride) dönülür. Sahte history yok.
 */
export const SearchDetailScreen: React.FC<Props> = ({ route, navigation }) => {
  const { activeSource } = useSource();
  const { tags, baseFilter } = route.params;

  const initialFilter = useMemo(() => {
    return baseFilter ? { ...baseFilter, tags, jumpToPage: 1 } : undefined;
  }, [baseFilter, tags]);

  return (
    <SearchScreen
      initialTag={tags.join(' ')}
      initialMode="replace"
      initialFilter={initialFilter}
      activeSource={activeSource}
      onBackPress={() => navigation.goBack()}
    />
  );
};
