# iOS freeze investigation — 29 Sep 2026

Branch: `fix/ios-player-lifecycle`, start point: `main` / `8403404`.

## Defects confirmed in code and their fixes

- `PostCard` called `useVideoPlayer(null)` even on image cards. That call
  creates a native player. Now only the active video child creates a player.
- An MP4 cover plus the video preview could open two players on the same card.
  A single video path is used; when visibility is lost the child unmounts.
- The Explore/Search preview visibility math did not include screen focus.
  Tab/stack focus, the app being in the foreground, and the app lock are now
  taken into account. A preview started by touch is also cleared on focus loss.
- When a real preview video exists, video plays (single player); the frame
  sequence is only the fallback for cards without video. In an intermediate
  build the slideshow was overriding the video: on XHamster two similar frames
  flickered at 500ms, on XVideos the video disappeared. While video is active
  the slideshow timer also stops (no needless re-render). On cards that need
  video there is at most one proxy attempt after an error; on a terminal error
  the player is removed.
- Removed the synchronous `replace()` in the grid and the timed retries.
  Silent previews explicitly use `mixWithOthers`; native video touches and
  Live Text analysis are off.
- In Explore, stale source/order requests could change the new list and its
  loading state. Request identity and the source key are checked. An
  empty/duplicate page stops auto-pagination; refresh reopens it.
- In the viewer, a resolved original URL (WebM) skipped the priority order and
  went straight to the player: it saw and passed the MP4 on the guard list, so
  the player got the WebM and produced an AVFoundation -11828 warning storm
  (the realbooru case). Primary selection was consolidated under
  `selectPrimaryVideoCandidate` (`media.ts`): a resolved URL that cannot open
  on iOS is skipped and the next playable candidate plays
  (`ImageViewerModal.tsx`). `VideoPlayerView` also no longer touches a released
  player in async continuations that finish after unmount (NotFoundException
  noise gone) and drops to the error card without loading an unsupported URL.
- XVideos CDNs (`thumb-cdn*`, `thumbs-gcore`, `mp4-cdn*`) are on the
  TLS-fragile list (`proxyService.ts`): if a worker is registered they are
  selectively proxied. On the direct leg, a host that fails terminally is
  skipped for the session (`gridPreviews.ts` dead-host cache) — each card does
  not produce a native attempt plus a warning, it stays on the static cover. A
  failure on the proxy leg does not kill the host.
- Settings > Image Quality has a "Video Previews" switch: when off, grid cards
  show static covers and no player is created at all
  (`src/utils/gridPreviews.ts`, `PostCard.tsx:109`). It does not affect
  viewer playback.
- The Explore/Search `ScrollView` used to mount every card (`n=120-148`). Cards
  outside the screen + 1500px overscan now fall back to a placeholder `View`
  (`src/utils/gridVisibility.ts:52`, `FeedScreen.tsx:469`,
  `SearchScreen.tsx:1166`). Mount count stays around 20 and scroll height is
  preserved. In the freeze log, `delay 432ms -> 1329ms` and `touch`
  imbalance (`162/159`) appeared while the list was growing.

## Verification

- `npm run test:freeze`: 17 regression tests. 200 photo cards, dual player,
  focus loss, frame preview, terminal error, wrong JPEG source, late source
  response, duplicate page, stale request `finally` race, 6 RedGifs token
  races and 2 mount-window tests (window size at 148 cards, total height
  preservation, window shift).
- `npx tsc --noEmit`: clean.
- iOS production bundle export: success.
- Native APIs are stubbed in tests. The freeze fix must be verified on a
  device: there should be no stall after `n=120+` in the same session.

## Corrections to earlier diagnoses

An open TCP connection does not prove reload was processed on the device. A
change in FPS numbers alone does not separate deadlock from livelock. The
earlier heartbeat read a file synchronously before the Metro log, so the two
outputs going quiet is not two independent measurements. The definitive
thread/livelock verdicts in the earlier report are not verified.

The CDP queries in that session timed out; the user reported the phone was
backgrounded/locked. That measurement was not used as freeze evidence.

## Device test

1. Fully close and reopen Expo Go. At start you should see
   `[FreezeProbe] ios-player-lifecycle-v3-sexcomdiag`.
2. Browse a few pages on RedGifs, enter/leave the Viewer, switch to Settings,
   go back to XVideos.
3. Expect `players=0` in the Settings output. The counter counts mounted grid
   video components on the JS side; it does not measure native memory being
   fully drained.
4. If it freezes, keep the app in the foreground. Save the last `[FreezeProbe]`
   line. Check whether `tick` still advances and whether the `touch` counters
   change while you touch the screen.
5. In the React Native DevTools console, `globalThis.__freezeProbe()` returns
   the last 30 events and the counters. This query only evaluates while the
   phone is in the foreground.

The new measurement works only in development mode, writes nothing to disk and
does not record media URLs. The root touch counters do not cover separate
native Modal windows.