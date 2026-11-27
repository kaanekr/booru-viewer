import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { X } from 'lucide-react-native';
import { TagCategory } from '../types/booru';
import { TagColors } from '../theme/colors';

interface TagChipProps {
  name: string;
  category?: TagCategory;
  count?: number;
  onPress?: (name: string) => void;
  onRemove?: () => void;
  inline?: boolean;
  size?: 'sm' | 'md';
}

const formatCount = (n: number) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

export const TagChip: React.FC<TagChipProps> = React.memo(({
  name,
  category = 'general',
  count,
  onPress,
  onRemove,
  inline = false,
  size = 'md',
}) => {
  const color = TagColors[category] || TagColors.general;
  const displayName = inline ? name : name.replace(/_/g, ' ');
  const handlePress = React.useCallback(() => {
    if (onRemove) onRemove();
    else onPress?.(name);
  }, [onPress, onRemove, name]);

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      disabled={!onPress && !onRemove}
      onPress={handlePress}
      accessibilityRole={onRemove ? 'button' : undefined}
      accessibilityLabel={onRemove ? `Remove tag: ${displayName}` : undefined}
      style={[
        styles.chip,
        { backgroundColor: color.bg, borderColor: color.border },
        size === 'sm' && styles.chipSmall,
        inline && styles.chipInline,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: color.text },
          size === 'sm' && styles.textSmall,
          inline && styles.textInline,
        ]}
        numberOfLines={1}
        ellipsizeMode="tail"
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
      {onRemove && <X size={13} color={color.text} style={styles.removeIcon} />}
    </TouchableOpacity>
  );
});

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
    maxWidth: '100%',
  },
  chipSmall: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  chipInline: {
    height: 28,
    paddingVertical: 0,
    justifyContent: 'center',
    marginRight: 5,
    marginBottom: 0,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  textInline: {
    lineHeight: 16,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  textSmall: {
    fontSize: 11,
    fontWeight: '500',
    flexShrink: 1,
  },
  removeIcon: {
    marginLeft: 5,
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
