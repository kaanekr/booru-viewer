import { StorageService } from './storage';

export interface ProxyConfig {
  enabled: boolean;
  workerUrl: string;
}

class ProxyService {
  private enabled: boolean = false;
  private workerUrl: string = '';
  private isInitialized: boolean = false;

  /**
   * iOS AVPlayer'da TLS handshake'i düşüren CDN host'ları (NSURLError -1200).
   * Canlı vaka: api-cdn-mp4.rule34.xxx üzerindeki .mp4'ler direkt bağlantıda
   * "A TLS error caused the secure connection to fail" veriyor, Worker
   * üzerinden aynı dosya sorunsuz oynuyor. Bu host'lar worker kayıtlıysa
   * global toggle kapalı olsa bile seçici olarak proxy'lenir; diğer
   * host'lar doğrudan kalır.
   */
  private static readonly TLS_FRAGILE_PATTERNS: RegExp[] = [
    /api-cdn[^/]*\.rule34\.(xxx|us)/i,
  ];

  /** Ham URL TLS-kırılgan bir CDN'e mi işaret ediyor? */
  isTlsFragileUrl(url: string | undefined): boolean {
    if (!url || typeof url !== 'string') return false;
    try {
      const decoded = decodeURIComponent(url);
      return ProxyService.TLS_FRAGILE_PATTERNS.some((re) => re.test(decoded));
    } catch {
      return ProxyService.TLS_FRAGILE_PATTERNS.some((re) => re.test(url));
    }
  }

  /** Proxy'li URL mi (kendisine tekrar proxy uygulanmasın)? */
  isProxiedUrl(url: string | undefined): boolean {
    if (!url || !this.workerUrl) return false;
    return url.startsWith(this.workerUrl);
  }

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
    // xvideos sıkıştırmalı gövdeyi worker yolunda 8KB'de kesiyor (canlı doğrulandı);
    // sıkıştırmasız istek tam sayfa (27 kart) dönüyor.
    if (/xvideos\.com/i.test(url)) out['Accept-Encoding'] = 'identity';
    return out;
  }

  /**
   * Dirençli fetch: önce direkt (toggle açıksa proxy), ağ kopması, takılma veya
   * 403/429/5xx'te kayıtlı worker varsa tek seferlik proxy'den tekrar dener.
   * Direkt bacakta da hard-timeout ile socket asılı kalmalarını engeller.
   * 404'te denemez (aday yoklama mantığı bozulmasın).
   */
  private initPromise: Promise<void> | null = null;

  async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;
    if (!this.initPromise) {
      this.initPromise = this.init();
    }
    await this.initPromise;
  }

  async fetchWithFallback(url: string, init?: RequestInit, retryTimeoutMs: number = 12000): Promise<Response> {
    await this.ensureInitialized();
    const target = this.proxyUrl(url);
    const scrub = !/redgifs\.com/i.test(url);
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const sig = init?.signal as AbortSignal | undefined;
      let directInit = init;
      if (!sig || sig.aborted) {
        const ctrl = new AbortController();
        timer = setTimeout(() => ctrl.abort(), retryTimeoutMs);
        directInit = { ...init, signal: ctrl.signal };
      }
      let raceTimer: ReturnType<typeof setTimeout> | undefined;
      const hardTimeout = new Promise<Response>((_, reject) => {
        raceTimer = setTimeout(() => reject(new Error(`fetch timeout after ${retryTimeoutMs}ms: ${url}`)), retryTimeoutMs);
      });

      let res: Response;
      try {
        const p = fetch(target, directInit);
        res = await Promise.race([
          p.then((v) => { if (raceTimer) clearTimeout(raceTimer); return v; }, (e) => { if (raceTimer) clearTimeout(raceTimer); throw e; }),
          hardTimeout,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }

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
      if (!viaProxy) throw e;
      if (viaProxy === target) {
        // Hedef zaten proxy'liydi: aynı URL'yi tekrar çekmek trafiği
        // ikiye katlar (özellikle timeout'ta ~24 sn). HTTP-statü bazlı
        // nötr-header denemesi yukarıda zaten yapıldı, burada dur.
        throw e;
      }
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
    // Global toggle açıksa: tüm trafik Worker üzerinden.
    if (this.isEnabled()) {
      if (originalUrl.startsWith(this.workerUrl)) return originalUrl;
      return `${this.workerUrl}?url=${encodeURIComponent(originalUrl)}`;
    }
    // Toggle kapalıysa: sadece TLS-kırılgan host'lar seçici proxy'lenir,
    // diğer sonuçlar doğrudan kalır.
    if (this.workerUrl && this.isTlsFragileUrl(originalUrl)) {
      if (originalUrl.startsWith(this.workerUrl)) return originalUrl;
      return `${this.workerUrl}?url=${encodeURIComponent(originalUrl)}`;
    }
    return originalUrl;
  }
}

export const proxyService = new ProxyService();
