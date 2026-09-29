import { useEffect, useState } from 'react';

// Izgara video onizleme anahtari: tum kartlar buradan okur (prop drilling yok).
// Ayarlar ekranindaki switch burayi + storage'i gunceller; kartlar abone olur.
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
