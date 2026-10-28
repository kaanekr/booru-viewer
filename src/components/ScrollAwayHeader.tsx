import React from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Colors } from '../theme/colors';
import type { useScrollAwayHeader } from '../utils/scrollAwayHeader';

/** An overlay only for populated grids. Empty/loading/form screens retain
 * their ordinary layout. Safe-area cover stays fixed while controls slide. */
export function ScrollAwayHeader({ controller, top = 0, children }: {
  controller: ReturnType<typeof useScrollAwayHeader>;
  top?: number;
  children: React.ReactNode;
}) {
  return (
    <View pointerEvents="box-none" style={controller.enabled ? [styles.overlay, { top }] : undefined}>
      <Animated.View
        testID="scroll-away-header"
        onLayout={controller.onHeaderLayout}
        style={[styles.surface, controller.enabled && { transform: [{ translateY: controller.translateY }] }]}
      >
        {children}
      </Animated.View>
      {controller.enabled && top > 0 && (
        <View pointerEvents="none" style={[styles.safeArea, { top: -top, height: top }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, zIndex: 20 },
  surface: { backgroundColor: Colors.dark.background },
  safeArea: { position: 'absolute', left: 0, right: 0, zIndex: 1, backgroundColor: Colors.dark.background },
});
