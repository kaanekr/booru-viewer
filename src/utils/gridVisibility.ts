import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface CardLayout {
  y: number;
  h: number;
}

/**
 * Grid visibility tracking: the parent passes a Map of each card's {y,h}
 * position from render into this hook on scroll; the hook returns the set
 * of on-screen (+margin) card ids. PostCard.videoActive is fed from here:
 * only visible video covers play, off-screen ones stop.
 */
export function useVisibleIds() {
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const keyRef = useRef('');

  const updateVisible = useCallback(
    (
      layouts: Map<string, CardLayout>,
      offsetY: number,
      viewportH: number,
      // Default margin 0: videoActive is given only to ON-SCREEN cards.
      // A 700px margin was used before; off-screen cards also opened
      // players and wasted decoder/bandwidth for nothing (on RedGifs every
      // card has a preview video). No visual change, player count is halved.
      margin: number = 0
    ) => {
      const top = offsetY - margin;
      const bottom = offsetY + viewportH + margin;
      const next = new Set<string>();
      layouts.forEach((r, id) => {
        if (r.y + r.h >= top && r.y <= bottom) next.add(id);
      });
      // Don't touch state when the set is identical (no wasted re-render)
      let key = '';
      next.forEach((id) => {
        key += id + ',';
      });
      if (key !== keyRef.current) {
        keyRef.current = key;
        setVisibleIds(next);
      }
    },
    []
  );

  return [visibleIds, updateVisible] as const;
}

/**
 * Pure window computation (testable): ids inside the window.
 */
export function computeWindowIds(
  layouts: Map<string, CardLayout>,
  offsetY: number,
  viewportH: number,
  margin: number
): Set<string> {
  const top = offsetY - margin;
  const bottom = offsetY + viewportH + margin;
  const next = new Set<string>();
  layouts.forEach((r, id) => {
    if (r.y + r.h >= top && r.y <= bottom) next.add(id);
  });
  return next;
}

/**
 * Mount window: on-screen cards + cards within the top/bottom overscan
 * are mounted, distant cards fall back to placeholder Views (unmount).
 * When ScrollView mounts the whole list (n=120+), every card holds hooks,
 * timers, images and sometimes a video player; the JS bridge and memory
 * fill up and the touch queue can't keep up. The window keeps mounts at
 * ~20 while placeholders preserve scroll height.
 */
export function useMountedIds(
  overscan: number = 1200,
  initialLayouts?: Map<string, CardLayout>,
  initialViewportH: number = 844
) {
  const [mountedIds, setMountedIds] = useState<Set<string> | null>(null);
  const keyRef = useRef('');

  const updateMounted = useCallback(
    (
      layouts: Map<string, CardLayout>,
      offsetY: number,
      viewportH: number,
      margin: number = overscan
    ) => {
      const next = computeWindowIds(layouts, offsetY, viewportH, margin);
      let key = '';
      next.forEach((id) => {
        key += id + ',';
      });
      if (key !== keyRef.current) {
        keyRef.current = key;
        setMountedIds(next);
      }
    },
    [overscan]
  );

  // Seed top-viewport mounted IDs synchronously on first paint / disjoint dataset
  // so 24-100 cards never mount all at once on frame 1 before useEffect prunes them.
  const effectiveMountedIds = useMemo(() => {
    if (!initialLayouts) return mountedIds;
    if (initialLayouts.size === 0) return new Set<string>();
    if (mountedIds && mountedIds.size > 0) {
      for (const id of mountedIds) {
        if (initialLayouts.has(id)) return mountedIds;
      }
    }
    return computeWindowIds(initialLayouts, 0, initialViewportH, overscan);
  }, [mountedIds, initialLayouts, initialViewportH, overscan]);

  return [effectiveMountedIds, updateMounted] as const;
}

/**
 * Returns the id set of the `maxActive` (default 4) cards nearest the
 * screen center among on-screen cards. In the 2-column grid, active
 * cards in both the left and right columns smoothly play live preview video.
 */
export function computeFocusedCardIds(
  layouts: Map<string, CardLayout>,
  offsetY: number,
  viewportH: number,
  playableIds?: Set<string>,
  maxActive: number = 4
): Set<string> {
  const centerY = offsetY + viewportH / 2;
  const candidates: { id: string; dist: number }[] = [];

  layouts.forEach((layout, id) => {
    if (playableIds && !playableIds.has(id)) return;
    // Card must be within screen bounds
    if (layout.y + layout.h >= offsetY && layout.y <= offsetY + viewportH) {
      const cardCenterY = layout.y + layout.h / 2;
      const dist = Math.abs(cardCenterY - centerY);
      candidates.push({ id, dist });
    }
  });

  candidates.sort((a, b) => a.dist - b.dist);
  const activeIds = new Set<string>();
  const count = Math.min(candidates.length, maxActive);
  for (let i = 0; i < count; i++) {
    activeIds.add(candidates[i].id);
  }
  return activeIds;
}

/**
 * Single focused-card computation:
 * Returns the id of the single card nearest the vertical screen center.
 */
export function computeFocusedCardId(
  layouts: Map<string, CardLayout>,
  offsetY: number,
  viewportH: number,
  playableIds?: Set<string>
): string | null {
  const ids = computeFocusedCardIds(layouts, offsetY, viewportH, playableIds, 1);
  return ids.values().next().value ?? null;
}

/**
 * Focused-card-set hook:
 * Picks the `maxActive` (default 1) card nearest the center among on-screen cards.
 * Debounces during scrolling (default 350ms) so fast scrolls don't needlessly
 * open and close native video players.
 */
export function useFocusedCardIds(debounceMs: number = 350, maxActive: number = 1) {
  const [focusedIds, setFocusedIds] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef('');
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const updateFocused = useCallback(
    (
      layouts: Map<string, CardLayout>,
      offsetY: number,
      viewportH: number,
      playableIds?: Set<string>,
      immediate?: boolean
    ) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const compute = () => {
        const next = computeFocusedCardIds(layouts, offsetY, viewportH, playableIds, maxActive);
        let key = '';
        next.forEach((id) => {
          key += id + ',';
        });
        if (key !== keyRef.current) {
          keyRef.current = key;
          setFocusedIds(next);
        }
      };

      if (immediate) {
        compute();
      } else {
        timerRef.current = setTimeout(compute, debounceMs);
      }
    },
    [debounceMs, maxActive]
  );

  return [focusedIds, updateFocused] as const;
}

/**
 * Single focused-card tracking hook (Instagram/Twitter single-player feed model):
 * Picks the single card nearest the center among on-screen cards.
 * Debounces during scrolling (120ms) so fast scrolls don't needlessly
 * open and close video players (zero churn).
 */
export function useFocusedCardId(debounceMs: number = 120) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const updateFocused = useCallback(
    (
      layouts: Map<string, CardLayout>,
      offsetY: number,
      viewportH: number,
      playableIds?: Set<string>,
      immediate?: boolean
    ) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }

      const compute = () => {
        const next = computeFocusedCardId(layouts, offsetY, viewportH, playableIds);
        setFocusedId(next);
      };

      if (immediate) {
        compute();
      } else {
        timerRef.current = setTimeout(compute, debounceMs);
      }
    },
    [debounceMs]
  );

  return [focusedId, updateFocused] as const;
}

