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
   * CDN hosts that drop the TLS handshake in iOS AVPlayer (NSURLError -1200).
   * Observed cases: files on api-cdn-mp4.rule34.xxx and thumb/mp4-cdn*.xvideos-cdn.com
   * fail over a direct connection with "A TLS error caused the secure
   * connection to fail". When a worker is registered, these hosts are
   * selectively proxied even with the global toggle off; other hosts
   * stay direct.
   */
  private static readonly TLS_FRAGILE_PATTERNS: RegExp[] = [
    /api-cdn[^/]*\.rule34\.(xxx|us)/i,
    /thumb-cdn\d*\.xvideos-cdn\.com/i,
    /thumbs-gcore\.xvideos-cdn\.com/i,
    /mp4-cdn\d*\.xvideos-cdn\.com/i,
    /videos\d*\.sex\.com/i,
    /premium-videos\d*\.sex\.com/i,
    /nhentai\.net/i,
  ];

  /** Does the raw URL point to a TLS-fragile CDN? */
  isTlsFragileUrl(url: string | undefined): boolean {
    if (!url || typeof url !== 'string') return false;
    try {
      const decoded = decodeURIComponent(url);
      return ProxyService.TLS_FRAGILE_PATTERNS.some((re) => re.test(decoded));
    } catch {
      return ProxyService.TLS_FRAGILE_PATTERNS.some((re) => re.test(url));
    }
  }

  /** Is this a proxied URL (don't proxy it again)? */
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

  /** Builds a URL via the registered worker even with the toggle off (for fallback). */
  forceProxyUrl(originalUrl: string | undefined): string {
    if (!originalUrl) return '';
    if (!this.workerUrl) return originalUrl;
    if (originalUrl.startsWith(this.workerUrl)) return originalUrl;
    return `${this.workerUrl}?url=${encodeURIComponent(originalUrl)}`;
  }

  /**
   * Neutral headers for the worker leg: browser mimicry (desktop UA,
   * Referer, Cookie) trips some WAFs into 403 on datacenter egress;
   * neutral iPhone UA + headerless passthrough returns 200 (verified live).
   * Except RedGifs: token requires matching UA + Origin/Referer.
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
    // xvideos truncates compressed bodies at 8KB on the worker path;
    // nhentai.net returning Brotli (br) stalls React Native iOS, which can't decode it (verified live).
    if (/xvideos\.com/i.test(url) || /nhentai\.net/i.test(url)) out['Accept-Encoding'] = 'gzip, deflate, identity';
    return out;
  }

  /**
   * Resilient fetch: direct first (proxy when the toggle is on); on network
   * failure, hang, or 403/429/5xx it retries once via the registered worker if set.
   * The direct leg also uses a hard timeout to keep hung sockets from stalling.
   * No retry on 404 (so candidate-probing logic stays intact).
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
    this.throwIfAborted(init?.signal);
    await this.ensureInitialized();
    this.throwIfAborted(init?.signal);
    const target = this.proxyUrl(url);
    const scrub = !/redgifs\.com/i.test(url);
    let res: Response;
    try {
      res = await this.fetchWithTimeout(target, init, retryTimeoutMs);
    } catch (e) {
      // A caller cancellation is final, not a reason to start a new download.
      this.throwIfAborted(init?.signal);
      const viaProxy = this.forceProxyUrl(url);
      if (!this.hasWorker() || viaProxy === target) throw e;
      return await this.fetchViaProxy(viaProxy, init, retryTimeoutMs, scrub);
    }

    this.throwIfAborted(init?.signal);
    if (!res.ok && (res.status === 403 || res.status === 429 || res.status >= 500)) {
      const viaProxy = this.forceProxyUrl(url);
      if (this.hasWorker() && viaProxy !== target) {
        return await this.fetchViaProxy(viaProxy, init, retryTimeoutMs, scrub);
      }
      if (scrub && this.isEnabled()) {
        // Keep this outside the direct-leg catch: a failed fallback is not retried again.
        return await this.fetchViaProxy(target, init, retryTimeoutMs, scrub);
      }
    }
    return res;
  }

  private async fetchViaProxy(viaProxy: string, init?: RequestInit, retryTimeoutMs: number = 12000, scrub: boolean = true): Promise<Response> {
    let retryInit = init;
    if (scrub) {
      retryInit = { ...retryInit, headers: this.workerHeaders(viaProxy, (retryInit?.headers as Record<string, string>) || {}) };
    }
    return await this.fetchWithTimeout(viaProxy, retryInit, retryTimeoutMs);
  }

  private throwIfAborted(signal?: AbortSignal | null): void {
    if (!signal?.aborted) return;
    const error = new Error('Request aborted');
    error.name = 'AbortError';
    throw error;
  }

  private async fetchWithTimeout(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response> {
    const signal = init?.signal;
    this.throwIfAborted(signal);
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    // Race as well as abort: some native fetch implementations do not settle on abort.
    const interrupted = new Promise<Response>((_, reject) => {
      onAbort = () => {
        const error = new Error('Request aborted');
        error.name = 'AbortError';
        reject(error);
        ctrl.abort();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => {
        reject(new Error(`fetch timeout after ${timeoutMs}ms`));
        ctrl.abort();
      }, timeoutMs);
    });
    try {
      // Keep a caller's signal attached to the response body as well as headers.
      return await Promise.race([fetch(url, { ...init, signal: signal ?? ctrl.signal }), interrupted]);
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
  }

  proxyUrl(originalUrl: string | undefined): string {
    if (!originalUrl) return '';
    // Global toggle on: all traffic goes through the Worker.
    if (this.isEnabled()) {
      if (originalUrl.startsWith(this.workerUrl)) return originalUrl;
      return `${this.workerUrl}?url=${encodeURIComponent(originalUrl)}`;
    }
    // Toggle off: only TLS-fragile hosts are selectively proxied,
    // everything else stays direct.
    if (this.workerUrl && this.isTlsFragileUrl(originalUrl)) {
      if (originalUrl.startsWith(this.workerUrl)) return originalUrl;
      return `${this.workerUrl}?url=${encodeURIComponent(originalUrl)}`;
    }
    return originalUrl;
  }
}

export const proxyService = new ProxyService();
