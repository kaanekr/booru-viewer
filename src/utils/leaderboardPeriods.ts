import type { TimeRangeOption } from '../types/booru';

/**
 * Liderlik capasi slotlari: tarih secici, aktif zaman dilimine gore
 * periyoda uygun secenek sunar (gun modunda gunler, hafta modunda
 * haftalar, ay modunda aylar). Secim, eslesen timeRange ile birlikte
 * uygulanir; boylece 'haftalikta tarih secince haftalik zaman secilmis olur'.
 * Tum tarihler YYYY-AA-GG takvim dizgesidir; hafta Pazartesi baslar
 * (sunucu da ayni hizalamayi yapar).
 */

export interface DateSlot {
  label: string;
  value: string | undefined;
  /** Secimde otomatik uygulanacak zaman dilimi. */
  range: TimeRangeOption;
}

const MONTHS_FULL = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

const MONTHS_ABBR = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara',
];

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

function fmtLocal(d: Date): string {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/** Gunluk / periyotsuz mod listesi (onceki davranisla ayni icerik). */
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
    day('Bugün / En Güncel', undefined),
    day('Dün (' + subDays(1) + ')', subDays(1)),
    day('2 Gün Önce (' + subDays(2) + ')', subDays(2)),
    day('3 Gün Önce (' + subDays(3) + ')', subDays(3)),
    day('1 Hafta Önce (' + subDays(7) + ')', subDays(7)),
    day('2 Hafta Önce (' + subDays(14) + ')', subDays(14)),
    day('1 Ay Önce (' + subMonths(1) + ')', subMonths(1)),
    day('2 Ay Önce (' + subMonths(2) + ')', subMonths(2)),
    day('3 Ay Önce (' + subMonths(3) + ')', subMonths(3)),
    day('6 Ay Önce (' + subMonths(6) + ')', subMonths(6)),
    day('1 Yıl Önce (' + subMonths(12) + ')', subMonths(12)),
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

/** Haftalik mod listesi: degerler Pazartesi capalaridir. */
export function weekDateOptions(now: Date = new Date(), count: number = 8): DateSlot[] {
  const base = mondayOf(now);
  const slots: DateSlot[] = [];
  for (let i = 0; i < count; i++) {
    const monday = new Date(base);
    monday.setDate(monday.getDate() - i * 7);
    const label =
      i === 0
        ? 'Bu Hafta (' + fmtWeekRange(monday) + ')'
        : i === 1
          ? 'Geçen Hafta (' + fmtWeekRange(monday) + ')'
          : i + ' Hafta Önce (' + fmtWeekRange(monday) + ')';
    slots.push({ label, value: i === 0 ? undefined : fmtLocal(monday), range: '1w' });
  }
  return slots;
}

/** Aylik mod listesi: degerler ayin 1'i capalaridir. */
export function monthDateOptions(now: Date = new Date(), count: number = 12): DateSlot[] {
  const slots: DateSlot[] = [];
  for (let i = 0; i < count; i++) {
    const first = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const label =
      (i === 0 ? 'Bu Ay' : i === 1 ? 'Geçen Ay' : i + ' Ay Önce') +
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
 * Satir etiketi: secili capanin etkin karsiligi. Haftada o gunun bulundugu
 * hafta araligi, ayda 'Ay Yil', gunlukte ham tarih gosterilir.
 */
export function describeAnchor(anchor: string | undefined, timeRange: string | undefined): string {
  if (!anchor) return 'Bugün / En Güncel';
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
