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
   * Dirençli fetch: önce direkt (toggle açıksa proxy), ağ kopması veya
   * 403/429/5xx'te kayıtlı worker varsa tek seferlik proxy'den tekrar dener.
   * 404'te denemez (aday yoklama mantığı bozulmasın).
   */
  async fetchWithFallback(url: string, init?: RequestInit, retryTimeoutMs: number = 12000): Promise<Response> {
    const target = this.proxyUrl(url);
    try {
      const res = await fetch(target, init);
      if (!res.ok && (res.status === 403 || res.status === 429 || res.status >= 500)) {
        const viaProxy = this.forceProxyUrl(url);
        if (viaProxy && viaProxy !== target) {
          return await this.fetchViaProxy(viaProxy, init, retryTimeoutMs);
        }
      }
      return res;
    } catch (e) {
      const viaProxy = this.forceProxyUrl(url);
      if (!viaProxy || viaProxy === target) throw e;
      return await this.fetchViaProxy(viaProxy, init, retryTimeoutMs);
    }
  }

  private async fetchViaProxy(viaProxy: string, init?: RequestInit, retryTimeoutMs: number = 12000): Promise<Response> {
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
