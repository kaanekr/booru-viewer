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
const MAX_IMMEDIATE_PER_COLUMN = MAX_CONCURRENT / 2;
const FAIL_OPEN_MS = 12_000;

let activeCount = 0;
const activeByColumn: Record<GridColumn, number> = { left: 0, right: 0 };
const reservedByColumn: Record<GridColumn, number> = { left: 0, right: 0 };
const queues: Record<GridColumn, Array<() => void>> = { left: [], right: [] };
let turn: GridColumn = 'left';
let pumpScheduled = false;
let reservedResetScheduled = false;

function scheduleReservedReset() {
  if (reservedResetScheduled) return;
  reservedResetScheduled = true;
  Promise.resolve().then(() => {
    reservedResetScheduled = false;
    reservedByColumn.left = 0;
    reservedByColumn.right = 0;
  });
}

function canOpenImmediately(column: GridColumn): boolean {
  const totalReserved = reservedByColumn.left + reservedByColumn.right;
  return (
    activeCount + totalReserved < MAX_CONCURRENT &&
    activeByColumn[column] + reservedByColumn[column] < MAX_IMMEDIATE_PER_COLUMN &&
    queues[column].length === 0
  );
}

function pump() {
  while (activeCount < MAX_CONCURRENT) {
    const turnQueue = queues[turn];
    const otherQueue = queues[turn === 'left' ? 'right' : 'left'];
    const nextCol = turnQueue.length > 0 ? turn : otherQueue.length > 0 ? (turn === 'left' ? 'right' : 'left') : null;
    if (!nextCol) return;
    const next = queues[nextCol].shift();
    if (!next) return;
    // Turn passes to the other column after each grant (fair sharing)
    turn = nextCol === 'left' ? 'right' : 'left';
    activeCount += 1;
    activeByColumn[nextCol] += 1;
    next();
  }
}

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  // Microtask: distribute after all enqueues in the same tick are collected.
  Promise.resolve().then(() => {
    pumpScheduled = false;
    pump();
  });
}

function releaseSlot(column?: GridColumn) {
  activeCount = Math.max(0, activeCount - 1);
  if (column) {
    activeByColumn[column] = Math.max(0, activeByColumn[column] - 1);
  }
  schedulePump();
}

interface Ticket {
  column?: GridColumn;
  granted: boolean;
  released: boolean;
  grant: (() => void) | null;
}

function finishTicket(ticket: Ticket) {
  if (ticket.released) return;
  ticket.released = true;
  if (ticket.granted) {
    ticket.granted = false;
    releaseSlot(ticket.column);
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
 * without one (e.g. FlatList screens) or when `enabled` is false it returns `true`
 * immediately without consuming a slot.
 * The returned release function must be called when the image finishes (or errors).
 */
export function useLoadGate(column?: GridColumn, enabled: boolean = true): [boolean, () => void] {
  const initialOpenRef = useRef<boolean | null>(null);
  if (initialOpenRef.current === null) {
    if (!column || !enabled) {
      initialOpenRef.current = true;
    } else if (canOpenImmediately(column)) {
      reservedByColumn[column] += 1;
      scheduleReservedReset();
      initialOpenRef.current = true;
    } else {
      initialOpenRef.current = false;
    }
  }

  const [open, setOpen] = useState<boolean>(initialOpenRef.current);
  const consumedInitialRef = useRef(false);
  const ticketRef = useRef<Ticket>({ column, granted: false, released: false, grant: null });

  useEffect(() => {
    if (!column || !enabled) {
      finishTicket(ticketRef.current);
      setOpen(true);
      return;
    }

    const ticket: Ticket = { column, granted: false, released: false, grant: null };
    ticketRef.current = ticket;

    const usedInitialSync = !consumedInitialRef.current && initialOpenRef.current === true;
    consumedInitialRef.current = true;

    if (usedInitialSync) {
      if (reservedByColumn[column] > 0) {
        reservedByColumn[column] -= 1;
      }
      if (activeCount < MAX_CONCURRENT) {
        activeCount += 1;
        activeByColumn[column] += 1;
        ticket.granted = true;
      }
    }

    if (!ticket.granted) {
      if (activeCount < MAX_CONCURRENT && queues[column].length === 0 && activeByColumn[column] < MAX_IMMEDIATE_PER_COLUMN) {
        activeCount += 1;
        activeByColumn[column] += 1;
        ticket.granted = true;
        setOpen(true);
      } else {
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
      }
    }

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
  }, [column, enabled]);

  const release = useCallback(() => {
    finishTicket(ticketRef.current);
  }, []);

  return [open, release];
}
