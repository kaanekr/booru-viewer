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

/**
 * Tek odaklı kart hesabı:
 * Ekranın dikey merkezine en yakın olan tek bir kartın id'sini döner.
 */
export function computeFocusedCardId(
  layouts: Map<string, CardLayout>,
  offsetY: number,
  viewportH: number,
  playableIds?: Set<string>
): string | null {
  const centerY = offsetY + viewportH / 2;
  let closestId: string | null = null;
  let minDistance = Infinity;

  layouts.forEach((layout, id) => {
    if (playableIds && !playableIds.has(id)) return;
    // Kart ekran sınırları içinde olmalı
    if (layout.y + layout.h >= offsetY && layout.y <= offsetY + viewportH) {
      const cardCenterY = layout.y + layout.h / 2;
      const dist = Math.abs(cardCenterY - centerY);
      if (dist < minDistance) {
        minDistance = dist;
        closestId = id;
      }
    }
  });

  return closestId;
}

/**
 * Tek odaklı kart takibi kancası (Instagram / Twitter tek oyuncu akış modeli):
 * Ekrandaki kartlar arasından merkeze en yakın TEK kartı seçer.
 * Kaydırma sırasında debounce (120ms) uygular; böylece hızlı kaydırma
 * esnasında gereksiz video oyuncu açılıp kapanmaz (sıfır fırtına).
 */
export function useFocusedCardId(debounceMs: number = 120) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

