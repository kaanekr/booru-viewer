import { useEffect, useState } from 'react';

// Grid video-preview switch: all cards read from here (no prop drilling).
// The switch on the Settings screen updates this + storage; cards subscribe.
let enabled = true;
const listeners = new Set<() => void>();

export function getGridPreviewsEnabled(): boolean {
  return enabled;
}

export function setGridPreviewsEnabled(value: boolean): void {
  if (enabled === value) return;
  enabled = value;
  listeners.forEach((notify) => {
    try {
      notify();
    } catch {}
  });
}

export function useGridPreviewsEnabled(): boolean {
  const [current, setCurrent] = useState(enabled);
  useEffect(() => {
    const notify = () => setCurrent(getGridPreviewsEnabled());
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, []);
  return current;
}

// A corrupt/expired clip must not disable every other file on its CDN.
// Cool down only this exact URL, with bounded memory and no background retry timers.
export const PREVIEW_RETRY_DELAY_MS = 30_000;
const failedUrls = new Map<string, number>();
const MAX_FAILED_URLS = 256;

export function markPreviewFailure(url: string | undefined): void {
  if (!url) return;
  failedUrls.delete(url);
  failedUrls.set(url, Date.now() + PREVIEW_RETRY_DELAY_MS);
  if (failedUrls.size > MAX_FAILED_URLS) failedUrls.delete(failedUrls.keys().next().value!);
}

export function isPreviewBlocked(url: string | undefined): boolean {
  if (!url) return false;
  const until = failedUrls.get(url);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  failedUrls.delete(url);
  return false;
}

export function clearPreviewFailure(url: string | undefined): void {
  if (url) failedUrls.delete(url);
}
