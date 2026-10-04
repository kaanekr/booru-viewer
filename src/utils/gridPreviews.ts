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

// Oturumluk negatif onbellek: direkt video yuklemesi olumcul patlayan host
// (TLS -1200, baglanti reset) bir daha denenmez; kart statik kapak/slayta
// duser. Boylece her yeni kart ayni host icin bir native deneme + uyari
// uretmez. Proxy bacagi denenmis basarisizliklar isaretlenmez (worker
// gecici bozulmus olabilir; direkt yol remount'ta tekrar denenir).
const deadHosts = new Set<string>();

function hostOf(url: string | undefined): string {
  if (typeof url !== 'string') return '';
  const noQuery = url.split('?')[0];
  const parts = noQuery.split('/');
  return (parts.length > 2 ? parts[2] : '').toLowerCase();
}

export function markPreviewHostDead(url: string | undefined): void {
  const h = hostOf(url);
  if (h) deadHosts.add(h);
}

export function isPreviewHostDead(url: string | undefined): boolean {
  const h = hostOf(url);
  return !!h && deadHosts.has(h);
}
