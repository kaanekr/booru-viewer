interface LruEntry<V> {
  value: V;
  expiresAt: number | null;
}

/**
 * Bounded least-recently-used cache with optional per-entry TTL.
 * Uses Map insertion order so `.get()` and `.set()` are O(1).
 */
export class LruCache<K, V> {
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number | null;
  private readonly map = new Map<K, LruEntry<V>>();

  constructor(maxEntries: number, defaultTtlMs?: number) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
    this.defaultTtlMs =
      typeof defaultTtlMs === 'number' && defaultTtlMs > 0 ? defaultTtlMs : null;
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // Promote to most-recently-used
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  has(key: K): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== null && Date.now() >= entry.expiresAt) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  set(key: K, value: V, ttlMs?: number | null): void {
    const effectiveTtl = ttlMs === undefined ? this.defaultTtlMs : ttlMs;
    const expiresAt =
      typeof effectiveTtl === 'number' && effectiveTtl > 0
        ? Date.now() + effectiveTtl
        : null;

    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, { value, expiresAt });

    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) break;
      this.map.delete(oldestKey);
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

/**
 * Deduplicates concurrent async computations for the same key.
 * Once settled (resolved or rejected), the key is removed so subsequent calls
 * can consult cache or retry cleanly.
 */
export function getOrDedup<K, V>(
  inFlight: Map<K, Promise<V>>,
  key: K,
  factory: () => Promise<V>
): Promise<V> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = factory().finally(() => {
    if (inFlight.get(key) === promise) {
      inFlight.delete(key);
    }
  });
  inFlight.set(key, promise);
  return promise;
}
