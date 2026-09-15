import { BooruSource } from '../types/booru';

export const AVAILABLE_SOURCES: BooruSource[] = [
  {
    id: 'safebooru',
    name: 'Safebooru',
    baseUrl: 'https://safebooru.org',
    type: 'gelbooru',
    description: 'Safe anime art & illustrations (High compatibility)',
    isSafeOnly: true,
  },
  {
    id: 'gelbooru',
    name: 'Gelbooru',
    baseUrl: 'https://gelbooru.com',
    type: 'gelbooru',
    description: 'The premier anime & artwork imageboard',
    isSafeOnly: false,
  },
  {
    id: 'konachan',
    name: 'Konachan (Wallpapers)',
    baseUrl: 'https://konachan.net',
    type: 'moebooru',
    description: 'High quality safe anime wallpapers',
    isSafeOnly: true,
  },
  {
    id: 'yandere',
    name: 'Yande.re',
    baseUrl: 'https://yande.re',
    type: 'moebooru',
    description: 'High resolution anime scans & art',
    isSafeOnly: false,
  },
  {
    id: 'danbooru',
    name: 'Danbooru',
    baseUrl: 'https://danbooru.donmai.us',
    type: 'danbooru',
    description: 'The largest anime imageboard (Requires DNS/VPN in some regions)',
    isSafeOnly: false,
  },
  {
    id: 'realbooru',
    name: 'Realbooru',
    baseUrl: 'https://realbooru.com',
    type: 'realbooru',
    description: 'Real & cosplay booru media',
    isSafeOnly: false,
  },
  {
    id: 'rule34',
    name: 'Rule34.xxx',
    baseUrl: 'https://api.rule34.xxx',
    type: 'gelbooru',
    description: 'Community anime & illustration board',
    isSafeOnly: false,
    authParams: 'REDACTED',
  },
  {
    id: 'cumst',
    name: 'Cum.st',
    baseUrl: 'https://cum.st',
    type: 'cumst',
    description: 'Creator media & clips archive',
    isSafeOnly: false,
  },
];

export const DEFAULT_SOURCE: BooruSource = AVAILABLE_SOURCES[0];
