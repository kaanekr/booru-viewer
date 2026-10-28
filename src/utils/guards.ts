/**
 * External data (API JSON, backup files, AsyncStorage) is not always the
 * expected type. These helpers centrally prevent "undefined is not a
 * function" class crashes.
 */

/** Returns '' if not a string. */
export function asStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Returns fallback if not a string. */
export function asStrOr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback;
}

/** Converts a value to a string list: string → split, array → string items, else []. */
export function asTagList(v: unknown, sep: RegExp = /\s+/): string[] {
  if (typeof v === 'string') return v.split(sep).filter(Boolean);
  if (Array.isArray(v)) return v.filter((t): t is string => typeof t === 'string');
  return [];
}

/** Returns only string elements (or [] otherwise). */
export function onlyStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : [];
}

/** Safe toLowerCase ('' if not a string). */
export function lower(v: unknown): string {
  return typeof v === 'string' ? v.toLowerCase() : '';
}

/** Checks the extension before query/fragment; false if url is not a string. */
export function urlEndsWith(url: unknown, ...suffixes: string[]): boolean {
  if (typeof url !== 'string') return false;
  const clean = url.split(/[?#]/)[0].toLowerCase();
  return suffixes.some((s) => clean.endsWith(s));
}
