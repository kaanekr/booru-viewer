import { useCallback, useRef, useState } from 'react';

export interface CardLayout {
  y: number;
  h: number;
}

/**
 * Izgara görünürlük takibi: ebeveyn render'da her kartın {y,h} konumunu
 * verdiği Map'i scroll'da bu kancaya verir, kanca ekrandaki (+marjin)
 * kart id setini döner. PostCard.videoActive buradan beslenir: sadece
 * görünür video kapaklar oynar, kaybolanlar durur.
 */
export function useVisibleIds() {
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const keyRef = useRef('');

  const updateVisible = useCallback(
    (
      layouts: Map<string, CardLayout>,
      offsetY: number,
      viewportH: number,
      // Varsayılan pay 0: videoActive yalnız EKRANDAKİ kartlara verilir.
      // 700px pay önceden kullanılıyordu; ekranda görünmeyen kartlar da
      // oynatıcı açıp boşuna decoder/bandwidth harcıyordu (RedGifs'te her
      // kartta önizleme videosu var). Görsel değişim yok, oyuncu sayısı yarıya iner.
      margin: number = 0
    ) => {
      const top = offsetY - margin;
      const bottom = offsetY + viewportH + margin;
      const next = new Set<string>();
      layouts.forEach((r, id) => {
        if (r.y + r.h >= top && r.y <= bottom) next.add(id);
      });
      // Aynı kümeyse state'e dokunma (gereksiz re-render yok)
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
 * Saf pencere hesabı (test edilebilir): pencere içindeki id'ler.
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
 * Mount penceresi: ekrandaki kartlar + alt/üst overscan içindeki kartlar
 * mount edilir, uzak kartlar yer tutucu View'e düşer (unmount).
 * ScrollView tüm listeyi mountladığında (n=120+) her kart hook, timer,
 * resim ve bazen video oyuncu tutar; JS köprüsü ve bellek dolar, dokunma
 * kuyruğu yetişemez. Pencere mount sayısını ~20'de tutar, kaydırma
 * yüksekliği yer tutucularla korunur.
 */
export function useMountedIds(overscan: number = 1500) {
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

  return [mountedIds, updateMounted] as const;
}
