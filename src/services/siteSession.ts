import type { BooruSource, BooruType } from '../types/booru';

const SITE_SESSIONS_KEY = '@booru_site_sessions_v1';
const ACCOUNT_SUPPORTED_TYPES = new Set<BooruType>(['pornhub', 'xhamster', 'xvideos', 'redgifs']);

function getAsyncStorage(): {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@react-native-async-storage/async-storage');
    const storage = mod?.default ?? mod;
    return typeof storage?.getItem === 'function' ? storage : null;
  } catch {
    return null;
  }
}

export interface SiteSessionRecord {
  cookie?: string;
  bearerToken?: string;
  updatedAt: number;
}

const sessions = new Map<string, SiteSessionRecord>();
const listeners = new Set<() => void>();
let initialized = false;
let initPromise: Promise<void> | null = null;

function notify(): void {
  listeners.forEach((fn) => {
    try { fn(); } catch {}
  });
}

function getNativeCookieBridge(): {
  getWebViewCookies?: (domain: string) => Promise<string>;
  clearWebViewCookies?: (domain: string) => Promise<void>;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const expo = require('expo');
    const mod = expo?.requireOptionalNativeModule?.('BooruHlsCache');
    return mod || null;
  } catch {
    return null;
  }
}

export function supportsSiteAccount(source: BooruSource | undefined): boolean {
  return Boolean(source && ACCOUNT_SUPPORTED_TYPES.has(source.type));
}

export function getSiteDomain(source: BooruSource): string {
  switch (source.type) {
    case 'pornhub':
      return 'pornhub.com';
    case 'xhamster':
      return 'xhamster.com';
    case 'xvideos':
      return 'xvideos.com';
    case 'redgifs':
      return 'redgifs.com';
    default:
      try {
        return new URL(source.baseUrl).hostname.replace(/^www\./, '');
      } catch {
        return '';
      }
  }
}

export function getSiteLoginUrl(source: BooruSource): string {
  const base = (source.baseUrl || '').replace(/\/$/, '');
  switch (source.type) {
    case 'pornhub':
      return `${base || 'https://www.pornhub.com'}/login`;
    case 'xhamster':
      return `${base || 'https://xhamster.com'}/login`;
    case 'xvideos':
      return `${base || 'https://www.xvideos.com'}/account`;
    case 'redgifs':
      return 'https://www.redgifs.com/login';
    default:
      return base;
  }
}

async function persistSessions(): Promise<void> {
  try {
    const storage = getAsyncStorage();
    if (!storage) return;
    const obj: Record<string, SiteSessionRecord> = {};
    sessions.forEach((value, key) => {
      obj[key] = value;
    });
    await storage.setItem(SITE_SESSIONS_KEY, JSON.stringify(obj));
  } catch {}
}

export async function initSiteSessions(): Promise<void> {
  if (initialized) return;
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const storage = getAsyncStorage();
        const raw = storage ? await storage.getItem(SITE_SESSIONS_KEY) : null;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            for (const [k, v] of Object.entries(parsed)) {
              if (v && typeof v === 'object') {
                const rec = v as SiteSessionRecord;
                if (rec.cookie || rec.bearerToken) {
                  sessions.set(k, {
                    cookie: typeof rec.cookie === 'string' && rec.cookie ? rec.cookie : undefined,
                    bearerToken: typeof rec.bearerToken === 'string' && rec.bearerToken ? rec.bearerToken : undefined,
                    updatedAt: Number(rec.updatedAt) || Date.now(),
                  });
                }
              }
            }
          }
        }
      } catch {
        // Ignore corrupt storage
      } finally {
        initialized = true;
        notify();
      }
    })();
  }
  await initPromise;
}

export function hasSiteSession(sourceId: string | undefined): boolean {
  if (!sourceId) return false;
  const rec = sessions.get(sourceId);
  return Boolean(rec && (rec.cookie || rec.bearerToken));
}

export function getSiteCookieHeader(sourceId: string | undefined): string {
  if (!sourceId) return '';
  return sessions.get(sourceId)?.cookie || '';
}

export function getSiteBearerToken(sourceId: string | undefined): string {
  if (!sourceId) return '';
  return sessions.get(sourceId)?.bearerToken || '';
}

export async function saveSiteSession(
  sourceId: string,
  patch: { cookie?: string; bearerToken?: string }
): Promise<void> {
  await initSiteSessions();
  const prev = sessions.get(sourceId);
  const next: SiteSessionRecord = {
    cookie: patch.cookie !== undefined ? (patch.cookie.trim() || undefined) : prev?.cookie,
    bearerToken: patch.bearerToken !== undefined ? (patch.bearerToken.trim() || undefined) : prev?.bearerToken,
    updatedAt: Date.now(),
  };
  if (next.cookie || next.bearerToken) {
    sessions.set(sourceId, next);
  } else {
    sessions.delete(sourceId);
  }
  notify();
  await persistSessions();
}

export async function captureNativeSiteCookies(source: BooruSource): Promise<string> {
  const domain = getSiteDomain(source);
  if (!domain) return '';
  const bridge = getNativeCookieBridge();
  if (!bridge?.getWebViewCookies) return '';
  try {
    const cookie = (await bridge.getWebViewCookies(domain)) || '';
    if (cookie.trim()) {
      await saveSiteSession(source.id, { cookie: cookie.trim() });
    }
    return cookie.trim();
  } catch {
    return '';
  }
}

export async function clearSiteSession(source: BooruSource): Promise<void> {
  await initSiteSessions();
  sessions.delete(source.id);
  notify();
  await persistSessions();
  const domain = getSiteDomain(source);
  const bridge = getNativeCookieBridge();
  if (domain && bridge?.clearWebViewCookies) {
    try {
      await bridge.clearWebViewCookies(domain);
    } catch {}
  }
}

export function subscribeSiteSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
