import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

export interface ScrollHeaderState {
  offset: number | null;
  headerOffset: number;
}

export const initialScrollHeaderState = (): ScrollHeaderState => ({ offset: null, headerOffset: 0 });

/** Ignore rubber-band movement and track scroll offset continuously inside [-height, 0]. */
export function advanceScrollHeader(state: ScrollHeaderState, event: NativeScrollEvent, height: number): ScrollHeaderState {
  const raw = event.contentOffset.y;
  if (!Number.isFinite(raw) || height <= 0) return state;
  const max = Math.max(0, event.contentSize.height - event.layoutMeasurement.height);
  const offset = Math.max(0, Math.min(raw, max));
  if (offset <= 0 || max === 0) return { offset, headerOffset: 0 };
  if (raw > max) return { ...state, offset };
  if (state.offset === null) return { offset, headerOffset: 0 };
  const delta = offset - state.offset;
  if (delta === 0) return state;
  const headerOffset = Math.max(-height, Math.min(0, state.headerOffset - delta));
  return { offset, headerOffset };
}

/** No React updates or layout animations during scrolling. Translates smoothly 1:1
 * with scroll offset and settles with a short native-driver animation on release. */
export function useScrollAwayHeader({ enabled, resetKey, pinned = false }: {
  enabled: boolean;
  resetKey: string;
  pinned?: boolean;
}) {
  const [height, setHeight] = useState(0);
  const translateY = useRef(new Animated.Value(0)).current;
  const state = useRef(initialScrollHeaderState());
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const occlusionRef = useRef(0);

  const reset = useCallback(() => {
    animation.current?.stop();
    state.current = initialScrollHeaderState();
    occlusionRef.current = enabled ? height : 0;
    translateY.setValue(0);
  }, [enabled, height, translateY]);

  useEffect(() => { reset(); }, [enabled, resetKey, height, reset]);
  useEffect(() => { if (pinned) reset(); }, [pinned, reset]);
  useEffect(() => () => { animation.current?.stop(); }, []);

  const onHeaderLayout = useCallback(({ nativeEvent }: LayoutChangeEvent) => {
    const measured = Math.ceil(nativeEvent.layout.height);
    if (measured > 0) setHeight((current) => current === measured ? current : measured);
  }, []);

  const onScroll = useCallback(({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!enabled || pinned) return false;
    const next = advanceScrollHeader(state.current, nativeEvent, height);
    const changed = next.headerOffset !== state.current.headerOffset;
    if (changed) {
      animation.current?.stop();
      occlusionRef.current = Math.max(0, height + next.headerOffset);
      translateY.setValue(next.headerOffset);
    }
    state.current = next;
    return changed;
  }, [enabled, pinned, height, translateY]);

  const settle = useCallback(() => {
    if (!enabled || pinned || height <= 0) return;
    const current = state.current.headerOffset;
    if (current === 0 || current === -height) return;
    const target = state.current.offset !== null && state.current.offset < height
      ? 0
      : current <= -height / 2
        ? -height
        : 0;
    state.current = { ...state.current, headerOffset: target };
    occlusionRef.current = Math.max(0, height + target);
    animation.current?.stop();
    animation.current = Animated.timing(translateY, {
      toValue: target,
      duration: 140,
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.current.start();
  }, [enabled, pinned, height, translateY]);

  return { enabled, height, translateY, occlusionRef, onHeaderLayout, onScroll, settle, reset };
}
