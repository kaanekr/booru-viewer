# Freeze Issue — Diagnostic Report

Date: 2026-09-29
Scope: "after browsing for a while, touching/interacting with content dies; only closing and reopening the app fixes it"

---

## 1. Symptom (user observations)

- The app "seems to work" but does not respond to anything.
- Scrolling advances the content **a little** (native momentum), touching does not work.
- Video plays in the Viewer, but the player bar stays at `00:00`.
- The only recovery is closing and reopening the app.
- Shake to Reload, or `r` in the Metro terminal — **neither works**.
- `expo-video` warning: `VideoPlayer.replace` loads the asset **synchronously on the main thread** on iOS → "UI freezes".
- `AVFoundation -11828 "Cannot Open"`: a **JPEG** (`…-medium.jpg`) is being handed to the video player.

---

## 2. Measurement results (on device, development build)

| Measurement | Value | Meaning |
|---|---|---|
| `setInterval` delay (JS thread) | 0–20 ms, with 440–2500 ms gaps | The JS thread is mostly healthy, not fully locked |
| `requestAnimationFrame` frame count | ~96–120 / 2 s (~50–60 fps) | UI/main thread alive |
| Root `onStartShouldSetResponderCapture` | **touches arrive** during the freeze | Touches reach the React tree, the bridge works |
| Active video player count | 0–4 (after the budget), peaks at 26 | No leak |
| Mounted heavy card count | 18–54 (after the window) | The tree is bounded |

**Result:** The freeze is not a thread lock. JS is up, UI is up, touches reach the root — yet no `Pressability`/`onPress` ever fires.

---

## 3. Ruled out (eliminated with evidence)

Each of these was disabled one at a time and tested; the freeze **continued**:

- Grid card images (`expo-image`) — off, freeze continued.
- Grid video previews (`expo-video`) — off, freeze continued.
- Content screen (Viewer) — off, freeze continued.
- Render window / mount rate limiter / playback budget (all with them off).
- Card count limit (120 cards) — freeze continued.
- App lock (`isLocked` log never appeared).
- Memory: grid images moved to disk cache, full-resolution decode limited to 2× screen, memory cleared on viewer exit.

---

## 4. Fixes applied (the permanent ones)

| # | Change | Rationale |
|---|---|---|
| 1 | `ViewerScreen`: `onClose` and the tag callbacks pinned with `useCallback` | The edge/timeline `PanResponder`s inside `ImageViewerModal` were memoized against these references and were recreated every render. Native handlers changed mid-gesture, so the ScrollView's `endDrag` got swallowed. |
| 2 | The app lock now only arms in the `background` state | `inactive` also fires for iOS `Alert`, Control Center, notifications and the app switcher. Locking on `inactive` could open an invisible lock layer on top of the app's own alert boxes. |
| 3 | `PostInfoModal` uses an in-screen layer instead of the RN `<Modal>` (on the wip branch) | A modal unmounted with `visible=true` kept its native window alive on iOS and permanently swallowed touches. |
| 4 | `replace()` → `replaceAsync()`, plus a gate on feeding image URLs to the player (`isVideoUrl`) | `replace` blocked the main thread synchronously and JPEGs were reaching the player. |
| 5 | Normalize the XVideos `THUMBNUM` template, frame loop 900 ms + touch-only | The template cover URL 404'd → a 4-request chain per card. |
| 6 | XHamster dual-player fix | A second `CardVideoPreview` opened on top of the cover mp4. |
| 7 | Grid players stop when screen focus is lost | The background grid kept playing while a content screen was open. |

> Items 3–7 live on the `wip-perf` branch (`941719b`); items 1 and 2 are on `main`.

---

## 5. Remaining candidates (JS measurement can no longer tell them apart)

Method measurement is exhausted, so the next candidates are on the
**device/native side**:

1. **A native system window stuck open.** If the `expo-local-authentication`
   biometric prompt or an RN `Alert` stays open: the app underneath runs,
   touches do not reach the app, and **a JS reload does not close that
   window** — shake/`r` doing nothing strongly supports this. → Check whether
   a system dialog was on screen at the moment of the freeze.
2. **`react-native-screens` / native-stack transition lock.** Back-to-back
   push/pop (`popToTop`, `goBack`, tag pushes) can stall the transition queue
   in fast chains. → Read the `react-native-screens` logs from the device
   console.
3. **Main thread stack.** The **main thread stack trace** at the moment of the
   freeze in the device console (Xcode → Devices and Simulators) gives the
   definitive answer: it points straight at the module where the stack waits.

---

## 6. Recommended next steps

1. **Run from Xcode instead of Metro** (instead of Expo Go). Capture the main
   thread stack at the moment of the freeze from the device console. This
   alone gives the root cause.
2. **Try a release build** (`eas build --profile production` or a local
   release). If the freeze only happens in a development build, the problem is
   in debug tooling/the inspector and does not affect users.
3. For candidate 1: temporarily disable the automatic biometric trigger in
   `LockScreen` (turn off the `useBiometrics` setting) and review `Alert` usage.
4. For candidate 2: try `fade`/`none` for the `RootStack` `animation` values;
   check the `enableFreeze`/`detachInactiveScreens` settings.

---

## 7. Approaches tried this session that did **not** work (do not repeat)

- Limiting the player count (budget 4) — unproven, ineffective.
- Changing the visibility margin from 700→0; solving the "tear down the player
  at the boundary" race with hysteresis — ineffective (it raised the player
  count from 14→26).
- Render window + mount rate limiter instead of virtualization — ineffective.
- Measuring with long logs — the logs blocked the bridge, corrupting the
  measurement; abandoned.
- Three rounds of binary search with dev bisect flags — the freeze continued in
  all combinations; the candidate pool could not be narrowed.

**Result:** The problem is not on the JS side. Metro logs no longer give
enough evidence; the next step is **capturing the main thread stack from the
device console**.

---

## 8. New session findings (evening of 29.09.2026, `fix/donma-clean` branch)

### 8.1. The reload channel dies while the socket stays alive (proven)
- At the moment of the freeze, `r` in Metro prints `Reloading apps` but the
  device does not respond (10 presses = 10 lines, zero effect).
- At the same time `netstat`: the dev machine LAN address → 5× `ESTABLISHED`
  (8081). TCP is open, the command is not processed.
- **Verdict:** the reload command travels over the Metro WS and the freeze
  kills that channel too. Reviving with `r`/shake is impossible; the only way
  is force-quit and reopen.

### 8.2. Distinguishing death with a double heartbeat
- `src/utils/heartbeat.ts`: every 3 s writes `time+route+src+n` to a file,
  every ~30 s sends `[Heartbeat] alive` to Metro.
- During the freeze **both went quiet** (file + Metro), but the perf monitor
  **kept showing fps**.
- **Verdict:** the threads are not fully dead; JS events cannot be processed in
  time (livelock — saturation). Not a classic deadlock.

### 8.3. Death contexts (heartbeat queues)
- Death 1: `route=Feed`, regular 3 s tick → sudden cut-off.
- Death 2: `route=Settings src=xvideos n=156`.
- Death 3: `route=Feed src=redgifs n=48→72→144` (while the page grows), with a
  **19 s gap + recovery** in between, then death at `src=xvideos n=48`.
- Pattern: death always happens while `n` grows; first a stall-recovery, then a
  full lock. The profile of accumulated load (player/event storm).

### 8.4. Expo Go `.ips` crash log
- `EXC_BAD_ACCESS SIGSEGV`, fault thread `com.facebook.react.runtime.JavaScript`.
- Stack: `hermes::doGetByIdSlowPath` ← `expo::callFunction` ←
  `JavaScriptPromise.resolve` ← `RuntimeScheduler runEventLoop`. A Promise
  callback on a dead object = use-after-free.
- The main thread is healthy (UITableView layout), no expo-video frame. This
  crash is a separate event from the hang that night, but it supports the
  post-unmount async callback family.

### 8.5. Fixes applied (committed on `fix/donma-clean`)
1. `PostCard.tsx:237,249,472` synchronous `replace()` → `replaceAsync()`
   (v57 docs: it loads synchronously on the UI thread on iOS).
2. `isVideoUrl` guard: JPEGs no longer reach the player (`media.ts` export +
   grid usage).
3. `useVideoPlayer` removed from the card and moved into `VideoCoverView`:
   **zero** native players on image cards (this also killed the
   `VideoPlayer.constructor` NPE on the Android emulator).
4. `CardVideoPreview` quota: max 4 simultaneous previews (`previewBudget.ts`);
   the rest stay on the static cover.
5. Terminal error → slideshow fallback + session host blacklist
   (`markVideoHostDead`): a proxy 503 / TLS -1202 host is not retried.
6. XVideos CDNs (`thumb-cdn*`, `thumbs-gcore`, `mp4-cdn*`) added to the
   TLS-fragile list (proxied up front when a worker is registered).
7. Known cost: the worker returns `HTTP 503` for these URLs (the Deno worker
   cannot fetch xvideos mp4) — the worker side is separate work.

### 8.6. Open questions
- With no worker registered all proxy protections are dormant — the direct leg
  runs into a broken certificate.
- After the quota + fallback the freeze **continued** ("it froze again"), so a
  video storm alone does not explain it; the LockScreen/`inactive` lock + the
  modal layer are still candidates.
- Next experiment: catch one more freeze with the `alive` heartbeat plus the
  file pair and pin down the death screen.