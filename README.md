# Booru Viewer

> **18+ ONLY. This app aggregates adult content. No minors.**

Multi-source image/video viewer built with Expo SDK 58 (React Native).
Browse, search, filter, favorite, and back up posts across supported booru and
video sources. English UI.

Exact Expo version docs: https://docs.expo.dev/versions/v58.0.0/

## Features

- Explore feed + search with filters (sort, time range, rating, score, platform, media type)
- Video previews on cards, full viewer with zoom
- Favorites, favorite tags, blacklist, search history, recent views
- App lock (4-digit PIN + biometrics)
- Backup import/export (AnimeBoxes `.abbj` / JSON)
- Optional Cloudflare Worker relay to bypass ISP censorship (no VPN)
- Gelbooru DAPI key support (user-provided, stored on-device only)

## Requirements

- Node 22.13+ (22.x), 24.3+ (24.x), or a newer supported even-numbered release
- Expo CLI (via `npx expo`)
- iOS Simulator / Android Emulator or an SDK 58-compatible Expo Go / development build

## Quick start

```bash
npm ci
npx expo start
```

- `npm run android` / `npm run ios` / `npm run web` — start per platform
- `npm run test:freeze` — run lifecycle tests (`node --test tests/*lifecycle.test.cjs`)

## Configuration

- Source: Settings → Choose Booru Source
- Image quality: Settings → Image Quality (Quick / Automatic / Full)
- Video previews: Settings → Video Previews
- Proxy relay: Settings → Network & Bypass
  1. Deploy your own Cloudflare Worker (never commit its URL).
  2. Paste it as `https://<your-worker>.workers.dev` (see `.env.example`).
  3. Use **Test Connection** to verify direct vs worker paths.
- Gelbooru DAPI: Settings → Gelbooru API Key. Keys are stored in
  AsyncStorage on-device only and never committed.

## Publish checklist (new repo)

This repo is sanitized for public publishing:

- [x] No hardcoded API keys (Gelbooru/Rule34 keys removed; backup JSON is an empty sample)
- [x] No bundled personal backup (root `*.abbj` is git-ignored and excluded)
- [x] `app.json` contains no private EAS `projectId` — new owner runs `eas init`
- [x] `android.package` set (`com.booru.viewer` — change to your reverse domain before Store submit)
- [x] `.gitignore` covers `.env*`, IPA/APK/AAB, native build dirs, credentials
- [x] English UI throughout
- [ ] **You must still do a clean export**: `git` history in the old repo may
      contain secrets. Create the new repo with a fresh `git init` from the
      sanitized tree (do NOT push `.git/`), then verify GitHub secret scanning.
- [ ] Rotate/revoke any Gelbooru/Rule34 keys that were ever committed.
- [ ] Redact/move internal docs (`docs/donma-raporu.md`, `HANDOFF_GLOBAL_STACK.md`)
      before publishing if they leak LAN IPs/paths.

## Security & privacy

- PIN is SHA-256 hashed with salt; biometric auth via `expo-local-authentication`.
- No keys/secrets are committed. User keys stay in AsyncStorage.
- `node_modules/`, `.expo/`, `build-ipa/`, `*.abbj`, credentials are ignored.

## Content & legal

- No affiliation with Gelbooru, Yande.re, Danbooru, Realbooru, Rule34,
  RedGifs, XVideos, XHamster, Pornhub, Sex.com, HentaiHaven, nhentai.
- Respect each source's Terms of Service and rate limits. Scraping-based
  sources may break or block; official APIs are preferred where available.
- Age gate + content filters are the distributor's responsibility before any
  Store submission. Get legal review for adult-content distribution.

## License

MIT — see [LICENSE](LICENSE).
