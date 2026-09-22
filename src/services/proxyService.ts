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

  proxyUrl(originalUrl: string | undefined): string {
    if (!originalUrl) return '';
    if (!this.isEnabled()) return originalUrl;
    if (originalUrl.startsWith(this.workerUrl)) return originalUrl;
    return `${this.workerUrl}?url=${encodeURIComponent(originalUrl)}`;
  }
}

export const proxyService = new ProxyService();
