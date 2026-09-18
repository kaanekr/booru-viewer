import { useCallback, useEffect, useRef, useState } from 'react';

export type GridColumn = 'left' | 'right';

/**
 * Grid resim yükleme kapısı (load gate).
 *
 * Sorun: ScrollView içindeki iki sütun aynı anda mount olunca sol sütunun
 * ~12 isteği iOS'un host başına ~6 bağlantı slotunu kapıyor, sağ sütun
 * kuyrukta bekleyip hep geç boyanıyordu.
 *
 * Çözüm: aynı anda en fazla MAX_CONCURRENT resim yüklenir; slotlar sol/sağ
 * kuyruklarına sırayla (turn-taking) dağıtılır. Böylece iki sütun simetrik
 * ilerler, biri diğerini aç bırakmaz. Slot biten işi (onLoadEnd/onError),
 * unmount'u veya 12sn fail-open zaman aşımını takiben bir sonrakine geçer.
 */

const MAX_CONCURRENT = 6;
const FAIL_OPEN_MS = 12_000;

let activeCount = 0;
const queues: Record<GridColumn, Array<() => void>> = { left: [], right: [] };
let turn: GridColumn = 'left';
let pumpScheduled = false;

function pump() {
  while (activeCount < MAX_CONCURRENT) {
    const turnQueue = queues[turn];
    const otherQueue = queues[turn === 'left' ? 'right' : 'left'];
    const next = turnQueue.shift() ?? otherQueue.shift();
    if (!next) return;
    // Her dağıtımdan sonra sıra diğer sütuna geçer (adil paylaşım)
    turn = turn === 'left' ? 'right' : 'left';
    activeCount += 1;
    next();
  }
}

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  // Microtask: aynı tick'teki tüm enqueue'ler toplandıktan sonra dağıt.
  // Senkron pump ilk 6 slotu hep önce mount olan (sol) sütuna verirdi.
  Promise.resolve().then(() => {
    pumpScheduled = false;
    pump();
  });
}

function releaseSlot() {
  activeCount = Math.max(0, activeCount - 1);
  schedulePump();
}

interface Ticket {
  granted: boolean;
  released: boolean;
  grant: (() => void) | null;
}

/**
 * column verilirse resim kapıdan geçene kadar `false` döner;
 * verilmezse (örn. FlatList ekranları) anında `true` — davranış değişmez.
 * Dönen release fonksiyonu resim bitince (veya hatada) çağrılmalı.
 */
export function useLoadGate(column?: GridColumn): [boolean, () => void] {
  const [open, setOpen] = useState(() => !column);
  const ticketRef = useRef<Ticket>({ granted: false, released: false, grant: null });

  useEffect(() => {
    if (!column) {
      setOpen(true);
      return;
    }
    const ticket = ticketRef.current;
    ticket.granted = false;
    ticket.released = false;
    setOpen(false);

    const grant = () => {
      if (!ticket.released) {
        ticket.granted = true;
        setOpen(true);
      }
    };
    ticket.grant = grant;
    queues[column].push(grant);
    schedulePump();

    // Fail-open: kapı bir nedenle takılırsa resmi sonsuza dek bekletme
    const failOpen = setTimeout(() => setOpen(true), FAIL_OPEN_MS);

    return () => {
      clearTimeout(failOpen);
      ticket.released = true;
      if (ticket.granted) {
        ticket.granted = false;
        releaseSlot();
      } else if (ticket.grant) {
        for (const c of ['left', 'right'] as GridColumn[]) {
          const i = queues[c].indexOf(ticket.grant);
          if (i >= 0) queues[c].splice(i, 1);
        }
        ticket.grant = null;
      }
    };
  }, [column]);

  const release = useCallback(() => {
    const ticket = ticketRef.current;
    if (ticket.released || !ticket.granted) return;
    ticket.released = true;
    ticket.granted = false;
    releaseSlot();
  }, []);

  return [open, release];
}
