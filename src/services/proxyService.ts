import { StorageService } from './storage';

export interface ProxyConfig {
  enabled: boolean;
  workerUrl: string;
}

class ProxyService {
  private enabled: boolean = false;
  private workerUrl: string = '';
  private isInitialized: boolean = false;

  async init(): Promise<void> {
    try {
      const config = await StorageService.getProxyConfig();
      this.enabled = config.enabled;
      this.workerUrl = config.workerUrl.trim().replace(/\/$/, '');
      this.isInitialized = true;
    } catch {
      this.enabled = false;
      this.workerUrl = '';
    }
  }

  setConfig(enabled: boolean, workerUrl: string): void {
    this.enabled = enabled;
    this.workerUrl = workerUrl.trim().replace(/\/$/, '');
  }

  isEnabled(): boolean {
    return this.enabled && Boolean(this.workerUrl);
  }

  getWorkerUrl(): string {
    return this.workerUrl;
  }

  hasWorker(): boolean {
    return Boolean(this.workerUrl);
  }

  /** Toggle kapalı olsa bile kayıtlı worker üzerinden URL üretir (fallback için). */
  forceProxyUrl(originalUrl: string | undefined): string {
    if (!originalUrl) return '';
    if (!this.workerUrl) return originalUrl;
    if (originalUrl.startsWith(this.workerUrl)) return originalUrl;
    return `${this.workerUrl}?url=${encodeURIComponent(originalUrl)}`;
  }

  /**
   * Worker bacağı için nötr header'lar: browser taklidi (desktop UA,
   * Referer, Cookie) bazı WAF'ları datacenter çıkışında 403'e sokuyor;
   * nötr iPhone UA + headersız geçiş 200 dönüyor (canlı doğrulandı).
   * RedGifs hariç: token, eşleşen UA + Origin/Referer ister.
   */
  workerHeaders(url: string, headers?: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = { ...(headers || {}) };
    if (/redgifs\.com/i.test(url)) return out;
    for (const k of Object.keys(out)) {
      const lk = k.toLowerCase();
      if (lk === 'referer' || lk === 'cookie') delete out[k];
    }
    out['User-Agent'] =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    return out;
  }

  /**
   * Dirençli fetch: önce direkt (toggle açıksa proxy), ağ kopması veya
   * 403/429/5xx'te kayıtlı worker varsa tek seferlik proxy'den tekrar dener.
   * 404'te denemez (aday yoklama mantığı bozulmasın).
   */
  async fetchWithFallback(url: string, init?: RequestInit, retryTimeoutMs: number = 12000): Promise<Response> {
    const target = this.proxyUrl(url);
    const scrub = !/redgifs\.com/i.test(url);
    try {
      const res = await fetch(target, init);
      if (!res.ok && (res.status === 403 || res.status === 429 || res.status >= 500)) {
        const viaProxy = this.forceProxyUrl(url);
        if (viaProxy && viaProxy !== target) {
          return await this.fetchViaProxy(viaProxy, init, retryTimeoutMs, scrub);
        }
        if (scrub && this.isEnabled()) {
          // Zaten proxy'deyiz ama browser header'lar WAF'a takıldı: nötr dene
          return await this.fetchViaProxy(target, init, retryTimeoutMs, scrub);
        }
      }
      return res;
    } catch (e) {
      const viaProxy = this.forceProxyUrl(url);
      if (!viaProxy || (viaProxy === target && !scrub)) throw e;
      return await this.fetchViaProxy(viaProxy, init, retryTimeoutMs, scrub);
    }
  }

  private async fetchViaProxy(viaProxy: string, init?: RequestInit, retryTimeoutMs: number = 12000, scrub: boolean = true): Promise<Response> {
    // Üst katmanın abort'u ateşlenmişse fallback anında ölmesin;
    // sinyal yoksa/ölüyse taze timeout'lu sinyal ver. Release'de abort
    // askıda kalabileceği için yarış zamanlayıcısı sözü mutlaka bitirir.
    let retryInit = init;
    const sig = init?.signal as AbortSignal | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!sig || sig.aborted) {
      const ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), retryTimeoutMs);
      retryInit = { ...init, signal: ctrl.signal };
    }
    if (scrub) {
      retryInit = { ...retryInit, headers: this.workerHeaders(viaProxy, (retryInit?.headers as Record<string, string>) || {}) };
    }
    let raceTimer: ReturnType<typeof setTimeout> | undefined;
    const hardTimeout = new Promise<Response>((_, reject) => {
      raceTimer = setTimeout(() => reject(new Error(`proxy timeout after ${retryTimeoutMs}ms`)), retryTimeoutMs);
    });
    try {
      const p = fetch(viaProxy, retryInit);
      return await Promise.race([
        p.then((v) => { if (raceTimer) clearTimeout(raceTimer); return v; }, (e) => { if (raceTimer) clearTimeout(raceTimer); throw e; }),
        hardTimeout,
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  proxyUrl(originalUrl: string | undefined): string {
    if (!originalUrl) return '';
    if (!this.isEnabled()) return originalUrl;
    if (originalUrl.startsWith(this.workerUrl)) return originalUrl;
    return `${this.workerUrl}?url=${encodeURIComponent(originalUrl)}`;
  }
}

export const proxyService = new ProxyService();
