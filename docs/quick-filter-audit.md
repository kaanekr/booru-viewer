# Source quick-filter audit

Checked on 2026-10-16 using the app's real query builders, adapters and parsers.
Raw results: [`quick-filter-audit.json`](./quick-filter-audit.json).

## Coverage and limits

- 110 source/surface/preset cases: 94 returned parsed posts; 10 Danbooru cases
  were blocked by HTTP 403; 6 Rule34 cases require personal credentials.
- Checks used direct desktop network requests, not the device's configured relay.
  No media files were downloaded. Counts can exceed the requested page size where
  an adapter expands attachments or the site's HTML listing has a fixed size.
- Results retain endpoint/query, first IDs, scores and ratings. A parsed HTTP 200
  alone does **not** prove every server-side filter's semantics. Request mappings,
  differing ordered IDs and the known no-op branches were also reviewed.
- Danbooru and authenticated Rule34 are retained based on adapter/query coverage,
  **not claimed as live-verified**. A blanket 403 is not evidence that a particular
  filter is unsupported. Sex.com remains hidden and has no implemented sort options.
- Native touch/render/pagination regression tests use mocked platform boundaries;
  they are not a substitute for an on-device UI test.

## Available quick buttons

| Source | Explore | Search |
| --- | --- | --- |
| Gelbooru / Rule34 / Realbooru | Latest, Top (all time) | Latest, Top, Safe, 50+ Points |
| Yande.re / Danbooru | Latest, Top, Weekly Top, Monthly Top | Same + Safe, 50+ Points |
| Cum.st | Latest, Daily/Weekly/Monthly Top | Same when query is empty; Latest, Videos, OnlyFans, Fansly with keywords |
| RedGifs | Trending, Latest, Weekly Top, Monthly Top | Same |
| XVideos | Discover, Latest, Monthly Best | Same without keywords; Relevance, Latest, Top, Weekly/Monthly Top, Top Rated with keywords |
| XHamster | Discover, Top, Weekly Top, Monthly Top | Same without keywords; Relevance, Latest, Top, Weekly/Monthly Top, Top Rated with keywords |
| Pornhub | Normal discover feed; no fake sort row | Discover without keywords; Relevance, Latest, Top, Weekly/Monthly Top, Top Rated with keywords |
| HentaiHaven | Latest, Monthly Trends, Latest Episodes, supported home genres | Same + additional one-tap genres |
| nhentai | Latest, Daily/Weekly/Monthly/All-time Top | Same |
| Sex.com (hidden) | No sort controls | No sort controls |

## Fixed or removed

- Explore now passes generated query tags to the adapter. Merely changing
  `sortBy` previously did nothing on engines that encode ordering in tags.
- Search buttons now execute even before the first search and use the current
  input text. They restart at page 1 and retain the appropriate query.
- Removed Safe/Points on providers that ignore those filters. Removed misleading
  Gelbooru/Rule34/Realbooru timed tops: Realbooru has no date-bound adapter and
  Gelbooru's unauthenticated HTML fallback loses the API date window.
- Yande.re Latest uses `order:id_desc`; `order:id` returned the oldest IDs.
- Gelbooru Safe uses `rating:general`; the old `rating:safe` returned no posts.
  Danbooru Safe uses `rating:g`, not sensitive (`rating:s`). All-time Danbooru Top
  uses `order:score`, not the daily-oriented `order:rank`.
- XVideos Latest uses `/new/1`, `/new/2`, etc.; Monthly Best uses `/best` and its
  resolved month archive for pagination. `/best` redirected to `/best/2026-09`
  during this audit, so the label is Monthly Best, not “last 30 days.”
- XHamster `/newest` and `/newest/1` returned HTTP 200 but **zero parsed cards**;
  no Explore Latest button was added. Its keyword-search Latest does return cards.
- Pornhub's keywordless first page always uses the homepage; unsupported Explore
  sort chips were not added. Keyword-search order/period options returned distinct IDs.
- Cum.st timed leaderboards are only offered without a keyword. Its `/posts/popular`
  path ignores service/media filters, so choosing a leaderboard clears those;
  choosing a service/media filter switches back to latest searchable posts.
- Saved Explore presets are normalized per source, preventing a stale weekly or
  HentaiHaven section choice from silently controlling a different source.

## Re-run

```powershell
node scripts/audit-quick-filters.cjs
node scripts/audit-quick-filters.cjs xvideos,gelbooru
npm run test:freeze
npx tsc --noEmit
```

The live audit is opt-in, rate-limited per provider and not part of the unit suite.
Rule34 credentials can optionally be supplied as `RULE34_USER_ID` and
`RULE34_API_KEY` environment variables; report URLs redact credentials.
