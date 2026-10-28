import type { BooruPost } from '../types/booru';

type PostIdentity = Pick<BooruPost, 'sourceId' | 'id'>;
const NUMERIC_BOORUS = new Set(['danbooru', 'gelbooru', 'rule34', 'realbooru', 'yandere']);

/** Source-qualified identity; accepts old AnimeBoxes numeric ID prefixes without rewriting backups. */
export function getPostKey(post: PostIdentity): string {
  const source = post.sourceId || '';
  let id = post.id;
  const prefix = `${source}_`;
  if (NUMERIC_BOORUS.has(source) && id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length))) {
    id = id.slice(prefix.length);
  }
  return JSON.stringify([source, id]);
}
