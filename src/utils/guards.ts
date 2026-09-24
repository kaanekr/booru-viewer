/**
 * Dış veri (API JSON, yedek dosyası, AsyncStorage) her zaman beklenen tipte
 * gelmez. Bu yardımcılar "undefined is not a function" sınıfı çökmeleri
 * merkezi olarak engeller.
 */

/** string değilse '' döner. */
export function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** string değilse varsayılanı döner. */
export function asStrOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/** Değeri string listesine çevirir: string → split, dizi → string elemanlar, diğer → []. */
export function asTagList(v: unknown, sep: RegExp = /\s+/): string[] {
  if (typeof v === 'string') return v.split(sep).filter(Boolean);
  if (Array.isArray(v)) return v.filter((t): t is string => typeof t === 'string');
  return [];
}

/** Dizideki yalnız string elemanları döndürür (değilse []). */
export function onlyStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
}

/** Sayı değilse varsayılanı döner. */
export function asNum(v: unknown, fallback: number): number {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isFinite(n) ? (n as number) : fallback;
}

/** Güvenli toLowerCase (string değilse ''). */
export function lower(v: unknown): string {
  return typeof v === 'string' ? v.toLowerCase() : '';
}

/** Soru işareti öncesi uzantı kontrolü; url string değilse false. */
export function urlEndsWith(url: unknown, ...suffixes: string[]): boolean {
  if (typeof url !== 'string') return false;
  const clean = url.split('?')[0].toLowerCase();
  return suffixes.some((s) => clean.endsWith(s));
}
