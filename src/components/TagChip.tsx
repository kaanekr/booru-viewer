import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TagCategory } from '../types/booru';
import { TagColors } from '../theme/colors';

interface TagChipProps {
  name: string;
  category?: TagCategory;
  count?: number;
  onPress?: (name: string) => void;
  size?: 'sm' | 'md';
}

export const TagChip: React.FC<TagChipProps> = ({
  name,
  category = 'general',
  count,
  onPress,
  size = 'md',
}) => {
  const color = TagColors[category] || TagColors.general;
  const displayName = name.replace(/_/g, ' ');

  const formatCount = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}m`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      disabled={!onPress}
      onPress={() => onPress && onPress(name)}
      style={[
        styles.chip,
        { backgroundColor: color.bg, borderColor: color.border },
        size === 'sm' && styles.chipSmall,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: color.text },
          size === 'sm' && styles.textSmall,
        ]}
        numberOfLines={1}
      >
        {displayName}
      </Text>
      {count !== undefined && (
        <View style={styles.countBadge}>
          <Text style={[styles.countText, { color: color.text }]}>
            {formatCount(count)}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 6,
    marginBottom: 6,
  },
  chipSmall: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
  },
  textSmall: {
    fontSize: 11,
    fontWeight: '500',
  },
  countBadge: {
    marginLeft: 5,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  countText: {
    fontSize: 10,
    fontWeight: '700',
    opacity: 0.85,
  },
});
