import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

export interface ScrollHeaderState {
  offset: number | null;
  travel: number;
  hidden: boolean;
}

export const initialScrollHeaderState = (): ScrollHeaderState => ({ offset: null, travel: 0, hidden: false });

/** Ignore rubber-band movement and require a deliberate direction change.
 * The initial header space must have scrolled away before hiding it. */
export function advanceScrollHeader(state: ScrollHeaderState, event: NativeScrollEvent, height: number): ScrollHeaderState {
  const raw = event.contentOffset.y;
  if (!Number.isFinite(raw) || height <= 0) return state;
  const max = Math.max(0, event.contentSize.height - event.layoutMeasurement.height);
  const offset = Math.max(0, Math.min(raw, max));
  if (offset <= 0 || max === 0) return { offset, travel: 0, hidden: false };
  if (raw > max) return { ...state, offset, travel: 0 };
  if (state.offset === null) return { ...state, offset };
  const delta = offset - state.offset;
  if (delta === 0) return state;
  const travel = Math.sign(delta) === Math.sign(state.travel) ? state.travel + delta : delta;
  const hidden = offset < height || travel <= -12 ? false : travel >= 12 ? true : state.hidden;
  return { offset, travel: Math.max(-12, Math.min(12, travel)), hidden };
}

/** No React updates or layout animations during scrolling. Only direction
 * transitions launch a short native-driver transform; card layout stays fixed. */
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
    const changed = next.hidden !== state.current.hidden;
    if (changed) {
      occlusionRef.current = next.hidden ? 0 : height;
      animation.current?.stop();
      animation.current = Animated.timing(translateY, {
        toValue: next.hidden ? -height : 0, duration: 180,
        useNativeDriver: true, isInteraction: false,
      });
      animation.current.start();
    }
    state.current = next;
    return changed;
  }, [enabled, pinned, height, translateY]);

  return { enabled, height, translateY, occlusionRef, onHeaderLayout, onScroll, reset };
}
