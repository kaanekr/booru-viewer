import { useCallback, useEffect, useRef, useState } from 'react';

export type GridColumn = 'left' | 'right';

/**
 * Grid image load gate.
 *
 * Problem: when both columns inside the ScrollView mount at once, the left
 * column's ~12 requests occupy iOS's ~6 per-host connection slots, so the
 * right column waits in the queue and always paints late.
 *
 * Fix: at most MAX_CONCURRENT images load at once; slots are handed out to
 * the left/right queues in turn (turn-taking). Both columns thus progress
 * symmetrically and neither starves the other. A slot passes to the next
 * waiter when the job finishes (onLoadEnd/onError), on unmount, or after
 * the 12s fail-open timeout.
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
    // Turn passes to the other column after each grant (fair sharing)
    turn = turn === 'left' ? 'right' : 'left';
    activeCount += 1;
    next();
  }
}

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  // Microtask: distribute after all enqueues in the same tick are collected.
  // A sync pump would always give the first 6 slots to the (left) column that mounted first.
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

function finishTicket(ticket: Ticket) {
  if (ticket.released) return;
  ticket.released = true;
  if (ticket.granted) {
    ticket.granted = false;
    releaseSlot();
  } else if (ticket.grant) {
    for (const column of ['left', 'right'] as GridColumn[]) {
      const index = queues[column].indexOf(ticket.grant);
      if (index >= 0) queues[column].splice(index, 1);
    }
  }
  ticket.grant = null;
}

/**
 * Returns `false` until the image passes the gate when a column is given;
 * without one (e.g. FlatList screens) it returns `true` immediately — no behavior change.
 * The returned release function must be called when the image finishes (or errors).
 */
export function useLoadGate(column?: GridColumn): [boolean, () => void] {
  const [open, setOpen] = useState(() => !column);
  const ticketRef = useRef<Ticket>({ granted: false, released: false, grant: null });

  useEffect(() => {
    if (!column) {
      setOpen(true);
      return;
    }
    const ticket: Ticket = { granted: false, released: false, grant: null };
    ticketRef.current = ticket;
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

    // Fail-open: never hold the image forever if the gate gets stuck
    const failOpen = setTimeout(() => {
      // Remove the waiter before bypassing the gate. A late grant must not
      // consume a slot after the image's release timer has already fired.
      finishTicket(ticket);
      setOpen(true);
    }, FAIL_OPEN_MS);

    return () => {
      clearTimeout(failOpen);
      finishTicket(ticket);
    };
  }, [column]);

  const release = useCallback(() => {
    finishTicket(ticketRef.current);
  }, []);

  return [open, release];
}
