# Booru Viewer

> **For adults 18 and older. Supported sources include adult content.**

Multi-source image/video viewer built with Expo SDK 58 (React Native).
Browse, search, filter, favorite, and back up posts across supported booru and
video sources. English UI.

[Expo SDK 58 reference](https://docs.expo.dev/versions/v58.0.0/)

## Features

- Explore feed + search with filters (sort, time range, rating, score, platform, media type)
- Video previews on cards, full viewer with zoom
- Favorites, favorite tags, blacklist, search history, recent views
- App lock (4-digit PIN + biometrics)
- Backup import/export (AnimeBoxes `.abbj` / JSON)
- Optional Cloudflare Worker relay for source connections
- Account and API settings for Gelbooru and Rule34

## Requirements

- Node 22.13+ (22.x), 24.3+ (24.x), or a newer supported even-numbered release
- Expo CLI (via `npx expo`)
- iOS Simulator / Android Emulator or an SDK 58-compatible Expo Go / development build

## Quick start

```bash
npm ci
npx expo start
```

- Run `npm run android`, `npm run ios`, or `npm run web` to start on a specific platform.
- Run `npm run test:freeze` to run the lifecycle test suite.

## Configuration

- Choose a source under **Settings → Sources**. Open its settings icon and select **Account & API** to enter your own credentials. Rule34 requires both a user ID and an API key. Gelbooru accepts a user ID and API key for DAPI access.
- Set image quality and card video previews under **Settings → Viewing**.
- Import an AnimeBoxes or JSON backup, or export your library as JSON, under **Settings → Storage & backup**.
- To use a Cloudflare Worker you control, enter its URL under **Settings → Connection → Cloudflare relay**, then use **Test connection** to compare direct and relay access. A saved Worker can be used as a fallback with **Route all traffic via Worker** turned off. Select **Remove Worker** to use direct connections only.

## Builds

The [iOS build workflow](.github/workflows/build-ios.yml) produces an unsigned IPA. A device installation requires signing for the intended device and distribution method.

For EAS builds from a fork, remove `expo.extra.eas.projectId` from your copy of `app.json`, then run `npx eas-cli@latest login` and `npx eas-cli@latest init` to link your own EAS project. Set your own `ios.bundleIdentifier` and `android.package` before distributing a fork. [Expo build guide](https://docs.expo.dev/build/setup/)

## Security & privacy

- The app hashes the lock PIN with a salt and uses the device's biometric authentication when enabled.
- User-provided API credentials are saved in the app's local AsyncStorage. Requests using those credentials go to the selected source and pass through the Worker when relay routing is used.
- Library exports can contain favorites, tags, and browsing and search history. Treat exports and diagnostics as private, and keep credentials, personal backups, and local traces out of commits and issue reports.

## Content & legal

- No affiliation with Gelbooru, Yande.re, Danbooru, Realbooru, Rule34,
  RedGifs, XVideos, XHamster, Pornhub, Sex.com, HentaiHaven, nhentai.
- Respect each source's Terms of Service and rate limits. Scraping-based
  sources may break or block. The app uses official APIs where supported.
- Age gate + content filters are the distributor's responsibility before any
  Store submission. Get legal review for adult-content distribution.

## License

MIT — see [LICENSE](LICENSE).
