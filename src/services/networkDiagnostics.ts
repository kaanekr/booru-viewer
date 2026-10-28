import { proxyService } from './proxyService';
import { PORNHUB_UA, PORNHUB_BASE, parsePornhubHtmlListing } from './pornhub';
import { SEXCOM_UA, SEXCOM_BASE, parseSexComListing } from './sexcom';
import { HENTAIHAVEN_UA, HENTAIHAVEN_BASE, parseHentaiHavenListing } from './hentaihavens';
import { XVIDEOS_UA, XVIDEOS_BASE, parseXVideosListing } from './xvideos';
import { XHAMSTER_UA, XHAMSTER_BASE, parseXhamsterListing } from './xhamster';
import type { BooruSource } from '../types/booru';

export interface ConnectionResult { name: string; direct: string; relay: string }

/** Reachability diagnostics, not a promise that a source is authenticated. */
export async function testProxyConnection(workerUrl: string): Promise<ConnectionResult[]> {
  const source = (id: string, baseUrl: string) => ({ id, name: id, baseUrl }) as BooruSource;
  const targets = [
    { name: 'Pornhub API', url: `${PORNHUB_BASE}/webmasters/search?search=test&page=1&thumbsize=medium`, ua: PORNHUB_UA },
    { name: 'Pornhub', url: `${PORNHUB_BASE}/video?o=mv&page=1`, ua: PORNHUB_UA, parse: (html: string) => parsePornhubHtmlListing(html, source('pornhub', PORNHUB_BASE)).length },
    { name: 'XHamster', url: `${XHAMSTER_BASE}/newest/1`, ua: XHAMSTER_UA, parse: (html: string) => parseXhamsterListing(html, source('xhamster', XHAMSTER_BASE)).length },
    { name: 'XVideos', url: `${XVIDEOS_BASE}/new/1`, ua: XVIDEOS_UA, parse: (html: string) => parseXVideosListing(html, source('xvideos', XVIDEOS_BASE)).length },
    { name: 'Sex.com', url: `${SEXCOM_BASE}/en/videos`, ua: SEXCOM_UA, parse: (html: string) => parseSexComListing(html, source('sexcom', SEXCOM_BASE)).length },
    { name: 'HentaiHaven', url: `${HENTAIHAVEN_BASE}/browse/trending/`, ua: HENTAIHAVEN_UA, parse: (html: string) => parseHentaiHavenListing(html, source('hentaihaven', HENTAIHAVEN_BASE)).length },
    { name: 'Sex.com CDN', url: 'https://videos2.sex.com/1038553/preview_240p.mp4', ua: SEXCOM_UA },
    { name: 'RedGifs', url: 'https://api.redgifs.com/v2/gifs/search?type=g&order=trending&count=1&page=1', ua: PORNHUB_UA },
  ];
  const probe = async (url: string, headers: Record<string, string>, parse?: (html: string) => number): Promise<string> => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = (async () => {
      try {
        const response = await fetch(url, { headers, signal: controller.signal });
        if (!response.ok || !parse) return String(response.status);
        return `${response.status} / ${parse(await response.text())} cards`;
      } catch (error: any) {
        return error?.name === 'AbortError' ? 'Timed out' : 'Unreachable';
      }
    })();
    try {
      // An abort can hang in native release builds: always settle the diagnostic.
      return await Promise.race([request, new Promise<string>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve('Timed out'); }, 12000);
      })]);
    } finally {
      if (timer) clearTimeout(timer);
      controller.abort();
    }
  };
  return Promise.all(targets.map(async (target) => {
    const headers: Record<string, string> = { 'User-Agent': target.ua, Referer: `${new URL(target.url).origin}/` };
    if (target.name === 'RedGifs') {
      headers.Origin = 'https://www.redgifs.com';
      headers.Referer = 'https://www.redgifs.com/';
    }
    const [direct, relay] = await Promise.all([
      probe(target.url, headers, target.parse),
      probe(`${workerUrl.replace(/\/$/, '')}?url=${encodeURIComponent(target.url)}`, proxyService.workerHeaders(target.url, headers), target.parse),
    ]);
    return { name: target.name, direct, relay };
  }));
}
