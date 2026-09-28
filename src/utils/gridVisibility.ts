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
