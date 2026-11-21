import { hentaiHavenTagQuery } from '../services/hentaihavens';
import { nhentaiTagQuery } from '../services/nhentai';
import type { BooruType, TagCategory } from '../types/booru';

export function splitSearchTags(query: string, allowComma = false): string[] {
  const pattern = allowComma ? /(?:"[^"]*(?:"|$)|[^\s,"])+/g : /(?:"[^"]*(?:"|$)|[^\s"])+/g;
  return query.match(pattern) ?? [];
}

export function getTagCompletion(query: string, allowComma = false) {
  const tokens = splitSearchTags(query, allowComma);
  const last = tokens.at(-1) ?? '';
  const quoted = (last.match(/"/g)?.length ?? 0) % 2 !== 0;
  const separator = allowComma ? /[\s,]$/ : /\s$/;
  if (!last || (!quoted && separator.test(query))) return null;

  const term = last.replace(/^-+/, '');
  const prefix = term.match(/^(tag|genre|artist|character|parody|group|language|category):/i)?.[1];
  return {
    previous: tokens.slice(0, -1),
    text: term.slice(prefix ? prefix.length + 1 : 0).replace(/^"|"$/g, '').trim(),
    prefix: prefix?.toLowerCase(),
    negated: last.startsWith('-'),
  };
}

export function quoteSearchTag(name: string): string {
  const label = name.replace(/"/g, '').trim();
  return /[\s,]/.test(label) ? `"${label}"` : label;
}

export function sourceTagQuery(type: BooruType | undefined, name: string, category?: TagCategory): string {
  if (/^-|^[a-z][a-z-]*:/i.test(name)) return name;
  if (type === 'nhentai') return nhentaiTagQuery(name, category);
  if (type === 'hentaihaven') return hentaiHavenTagQuery(name, category);
  if (type === 'redgifs' && category === 'artist') return `user:${name}`;
  if ((type === 'pornhub' || type === 'xvideos') && category === 'general') {
    return `tag:${quoteSearchTag(name.replace(/_/g, ' '))}`;
  }
  if (type === 'xvideos' || type === 'xhamster' || type === 'pornhub') return quoteSearchTag(name.replace(/_/g, ' '));
  return name;
}
