import type { TimeRangeOption } from '../types/booru';

/**
 * Leaderboard anchor slots: the date picker offers period-appropriate
 * options for the active time range (days in day mode, weeks in week
 * mode, months in month mode). The selection is applied together with
 * its matching timeRange, so picking a date in weekly mode selects
 * weekly time. All dates are YYYY-MM-DD calendar strings; weeks start
 * on Monday (the server aligns the same way).
 */

export interface DateSlot {
  label: string;
  value: string | undefined;
  /** Time range auto-applied on selection. */
  range: TimeRangeOption;
}

const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTHS_ABBR = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

function fmtLocal(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** Daily / period-less mode list (same content as previous behavior). */
export function dayDateOptions(now: Date = new Date()): DateSlot[] {
  const formatDate = (d: Date) => fmtLocal(d);
  const subDays = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return formatDate(d);
  };
  const subMonths = (months: number) => {
    const d = new Date(now);
    d.setMonth(d.getMonth() - months);
    return formatDate(d);
  };
  const day = (label: string, value: string | undefined): DateSlot => ({ label, value, range: '1d' });
  return [
    day('Today / Latest', undefined),
    day('Yesterday (' + subDays(1) + ')', subDays(1)),
    day('2 Days Ago (' + subDays(2) + ')', subDays(2)),
    day('3 Days Ago (' + subDays(3) + ')', subDays(3)),
    day('1 Week Ago (' + subDays(7) + ')', subDays(7)),
    day('2 Weeks Ago (' + subDays(14) + ')', subDays(14)),
    day('1 Month Ago (' + subMonths(1) + ')', subMonths(1)),
    day('2 Months Ago (' + subMonths(2) + ')', subMonths(2)),
    day('3 Months Ago (' + subMonths(3) + ')', subMonths(3)),
    day('6 Months Ago (' + subMonths(6) + ')', subMonths(6)),
    day('1 Year Ago (' + subMonths(12) + ')', subMonths(12)),
  ];
}

function mondayOf(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
  return out;
}

function fmtDay(d: Date): string {
  return d.getDate() + ' ' + MONTHS_ABBR[d.getMonth()];
}

function fmtWeekRange(monday: Date): string {
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  if (monday.getMonth() === sunday.getMonth()) {
    return monday.getDate() + '-' + sunday.getDate() + ' ' + MONTHS_ABBR[monday.getMonth()];
  }
  return fmtDay(monday) + ' - ' + fmtDay(sunday);
}

/** Weekly mode list: values are Monday anchors. */
export function weekDateOptions(now: Date = new Date(), count: number = 8): DateSlot[] {
  const base = mondayOf(now);
  const slots: DateSlot[] = [];
  for (let i = 0; i < count; i++) {
    const monday = new Date(base);
    monday.setDate(monday.getDate() - i * 7);
    const label =
      i === 0
        ? 'This Week (' + fmtWeekRange(monday) + ')'
        : i === 1
          ? 'Last Week (' + fmtWeekRange(monday) + ')'
          : i + ' Weeks Ago (' + fmtWeekRange(monday) + ')';
    slots.push({ label, value: i === 0 ? undefined : fmtLocal(monday), range: '1w' });
  }
  return slots;
}

/** Monthly mode list: values are the 1st-of-month anchors. */
export function monthDateOptions(now: Date = new Date(), count: number = 12): DateSlot[] {
  const slots: DateSlot[] = [];
  for (let i = 0; i < count; i++) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label =
      (i === 0 ? 'This Month' : i === 1 ? 'Last Month' : i + ' Months Ago') +
      ' (' + MONTHS_FULL[first.getMonth()] + ' ' + first.getFullYear() + ')';
    slots.push({ label, value: i === 0 ? undefined : fmtLocal(first), range: '1m' });
  }
  return slots;
}

function parseISODate(iso: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/**
 * Row label: the effective equivalent of the selected anchor. Shows the
 * containing week range in weekly mode, 'Month Year' in monthly mode,
 * and the raw date in daily mode.
 */
export function describeAnchor(anchor: string | undefined, timeRange: string | undefined): string {
  if (!anchor) return 'Today / Latest';
  const clean = anchor.trim();
  if (timeRange === '1w') {
    const parts = parseISODate(clean);
    if (!parts) return clean;
    const dt = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
    if (dt.getUTCFullYear() !== parts.y || dt.getUTCMonth() !== parts.m - 1 || dt.getUTCDate() !== parts.d) {
      return clean;
    }
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    const monday = dt;
    const sunday = new Date(dt);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const monAbbr = MONTHS_ABBR[monday.getUTCMonth()];
    if (monday.getUTCMonth() === sunday.getUTCMonth()) {
      return monday.getUTCDate() + '-' + sunday.getUTCDate() + ' ' + monAbbr;
    }
    return monday.getUTCDate() + ' ' + monAbbr + ' - ' + sunday.getUTCDate() + ' ' + MONTHS_ABBR[sunday.getUTCMonth()];
  }
  if (timeRange === '1m') {
    const parts = parseISODate(clean);
    if (!parts) return clean;
    return MONTHS_FULL[parts.m - 1] + ' ' + parts.y;
  }
  return clean;
}
