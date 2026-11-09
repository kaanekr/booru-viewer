import SwiftUI
import AVFoundation
import Foundation
import UIKit

/// One page of the full-screen viewer: an image with pinch / double-tap zoom, a
/// playing video, or a multi-page gallery/manga reader.
///
/// Mirrors the per-page behaviour of RN `PostPageItem`
/// (src/components/ImageViewerModal.tsx:800-1990): pinch and double-tap zoom for
/// images, `AVPlayer` playback with mute + scrubber for videos, and a multi-page
/// reader when the post carries gallery pages.
struct ZoomableMediaView: View {
    let post: BooruPost
    let media: ResolvedMedia?
    var isLoading = false
    var isActive = true
    var isMangaMode = false
    var galleryPages: [URL] = []
    /// Mirrors the viewer's controls visibility so the video transport card hides
    /// together with `ViewerScreen`'s top/bottom bars.
    var showsControls = true
    /// Single tap on the media toggles the viewer controls (RN `handleToggleControls`).
    var onSingleTap: (() -> Void)?
    /// Reports pinch / double-tap zoom so the viewer can stand down its own
    /// dismissal drags while the media pan owns the touch.
    var onZoomChanged: ((Bool) -> Void)?

    var body: some View {
        Group {
            if isMangaMode, galleryPages.count > 1 {
                PrivateMangaReaderView(
                    pages: galleryPages,
                    aspectRatioFallback: post.aspectRatio,
                    onSingleTap: onSingleTap,
                    onZoomChanged: onZoomChanged
                )
            } else if let videoURL = media?.videoURL {
                PrivateVideoPlaybackView(
                    url: videoURL,
                    isActive: isActive,
                    showsControls: showsControls,
                    onSingleTap: onSingleTap
                )
                .id(videoURL)
            } else {
                imagePage
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onChange(of: zoomScale) { _, scale in
            onZoomChanged?(scale > Self.zoomEpsilon)
        }
        // RN resets the previous page's zoom once it stops being the visible one
        // (ImageViewerModal.tsx:1300-1328).
        .onChange(of: isActive) { _, active in
            if !active { resetZoom() }
        }
    }

    // MARK: Image page (pinch + double-tap zoom)

    private var imagePage: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let nhentaiCover = post.sourceID == .nhentai ? (post.sampleURL ?? post.previewURL) : nil
            let imageChain = [media?.imageURL, media?.placeholderURL, nhentaiCover].compactMap { $0 }

            ZStack {
                Color.black

                if imageChain.isEmpty {
                    unavailable
                } else {
                    PrivateViewerImage(urls: imageChain)
                        .frame(width: size.width, height: size.height)
                }

                if isLoading {
                    ProgressView()
                        .tint(AppTheme.textPrimary)
                        .padding(12)
                        .background(.ultraThinMaterial, in: Circle())
                }
            }
            .frame(width: size.width, height: size.height)
            .scaleEffect(zoomScale, anchor: zoomAnchor)
            .offset(zoomOffset)
            .contentShape(Rectangle())
            .gesture(magnificationGesture)
            .simultaneousGesture(panGesture(size: size), including: zoomScale > Self.zoomEpsilon ? .all : .none)
            .gesture(tapGesture(size: size))
        }
    }

    private var unavailable: some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle")
                .font(.title2)
            Text("Media unavailable")
                .font(.footnote)
        }
        .foregroundStyle(AppTheme.textSecondary)
    }

    // MARK: Zoom state

    @State private var zoomScale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var zoomOffset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    /// Anchor of the double-tap zoom: the tapped point, in view-unit coordinates
    /// (RN zooms onto the tap location, ImageViewerModal.tsx:1408-1422).
    @State private var zoomAnchor: UnitPoint = .center

    private static let zoomEpsilon: CGFloat = 1.01
    private static let doubleTapScale: CGFloat = 2.5

    private var magnificationGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                zoomScale = min(max(1, lastScale * value.magnification), 4)
            }
            .onEnded { _ in
                lastScale = zoomScale
                if zoomScale <= Self.zoomEpsilon {
                    resetZoom()
                }
            }
    }

    /// Only pans while zoomed in: the gesture is masked out at 1x so horizontal
    /// drags pass straight through to the paged `TabView`.
    private func panGesture(size: CGSize) -> some Gesture {
        DragGesture()
            .onChanged { value in
                guard zoomScale > Self.zoomEpsilon else { return }
                let moved = CGSize(
                    width: lastOffset.width + value.translation.width,
                    height: lastOffset.height + value.translation.height
                )
                zoomOffset = clampZoomOffset(moved, scale: zoomScale, anchor: zoomAnchor, size: size)
            }
            .onEnded { _ in
                if zoomScale > Self.zoomEpsilon {
                    lastOffset = zoomOffset
                } else {
                    resetZoom()
                }
            }
    }

    /// Double tap zooms onto the tapped point, a single tap toggles the controls.
    /// `exclusively` keeps the double tap from also firing the single-tap handler.
    private func tapGesture(size: CGSize) -> some Gesture {
        SpatialTapGesture(count: 2)
            .onEnded { value in
                handleDoubleTap(at: value.location, in: size)
            }
            .exclusively(
                before: TapGesture(count: 1).onEnded { _ in
                    guard let onSingleTap = onSingleTap else { return }
                    onSingleTap()
                }
            )
    }

    private func handleDoubleTap(at location: CGPoint, in size: CGSize) {
        withAnimation(.easeInOut(duration: 0.2)) {
            if zoomScale > Self.zoomEpsilon {
                resetZoom()
            } else {
                zoomAnchor = unitPoint(for: location, in: size)
                zoomScale = Self.doubleTapScale
                lastScale = Self.doubleTapScale
                zoomOffset = .zero
                lastOffset = .zero
            }
        }
    }

    /// Tap location → `UnitPoint` anchor, clamped to the view bounds.
    private func unitPoint(for location: CGPoint, in size: CGSize) -> UnitPoint {
        guard size.width > 0, size.height > 0 else { return .center }
        return UnitPoint(
            x: min(max(location.x / size.width, 0), 1),
            y: min(max(location.y / size.height, 0), 1)
        )
    }

    private func resetZoom() {
        zoomScale = 1
        lastScale = 1
        zoomOffset = .zero
        lastOffset = .zero
        zoomAnchor = .center
    }
}

// MARK: - Loader-backed viewer image

/// Full-resolution viewer image and manga page loaded through `MediaImageLoader`,
/// so the request carries the per-host `Referer`/`User-Agent` headers and retries
/// through the Cloudflare Worker relay (`ProxyRelay`) for TLS-fragile CDNs — the
/// same route the feed covers get from `AsyncMediaImage`. Plain `AsyncImage` cannot
/// express either, which left the full-screen image and every nhentai page bare.
private struct PrivateViewerImage: View {
    let urls: [URL]
    var failureText = "Media unavailable"

    @State private var image: UIImage?
    @State private var didFail = false
    /// URLs whose image is already applied, so a parent re-render never re-runs
    /// the task (or flashes the spinner) for a decoded page.
    @State private var loadedURLs: [URL]?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
            } else if didFail {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.title2)
                    Text(failureText)
                        .font(.footnote)
                }
                .foregroundStyle(AppTheme.textSecondary)
            } else {
                ProgressView()
                    .tint(AppTheme.textPrimary)
            }
        }
        .task(id: urls) { await load() }
    }

    /// Walks the chain until one URL decodes; a cached image is applied without a
    /// visible placeholder frame. The loader already retried the other route leg.
    /// An already-loaded image is kept across view updates, so re-rendering the
    /// page never flashes the spinner.
    private func load() async {
        guard loadedURLs != urls else { return }
        guard !urls.isEmpty else {
            image = nil
            didFail = true
            return
        }

        // Fast path: check cache for all candidates first without clearing image.
        for url in urls {
            if Task.isCancelled { return }
            if let cached = await MediaImageLoader.shared.cachedImage(for: url) {
                if Task.isCancelled { return }
                image = cached
                loadedURLs = urls
                didFail = false
                return
            }
        }

        didFail = false
        for url in urls {
            if Task.isCancelled { return }
            do {
                let loaded = try await MediaImageLoader.shared.image(for: url)
                if Task.isCancelled { return }
                image = loaded
                loadedURLs = urls
                return
            } catch {
                continue
            }
        }
        image = nil
        didFail = true
    }
}

// MARK: - Anchored zoom maths

/// Clamps a pan offset so a view scaled with `scaleEffect(_:anchor:)` never shows
/// the frame behind it. Scaling about `anchor` already overhangs the frame by
/// `anchor * size * (scale - 1)` on one side and `(1 - anchor) * size * (scale - 1)`
/// on the other, and the offset may only travel that far.
private func clampZoomOffset(
    _ offset: CGSize,
    scale: CGFloat,
    anchor: UnitPoint,
    size: CGSize
) -> CGSize {
    guard scale > 1, size.width > 0, size.height > 0 else { return .zero }
    let maxX = anchor.x * (scale - 1) * size.width
    let minX = -(1 - anchor.x) * (scale - 1) * size.width
    let maxY = anchor.y * (scale - 1) * size.height
    let minY = -(1 - anchor.y) * (scale - 1) * size.height
    return CGSize(
        width: min(max(offset.width, minX), maxX),
        height: min(max(offset.height, minY), maxY)
    )
}

// MARK: - Video playback

/// `AVPlayer`-backed video page with play/pause, a scrubber and a mute toggle
/// (RN video controls, ImageViewerModal.tsx:1993-2500).
///
/// The surface is a bare `AVPlayerLayer` (`AVPlayerSurfaceView`), so the native
/// `AVPlayerViewController` transport bar never appears alongside these controls.
/// Items are built through `MediaRequestConfiguration`, which means the request
/// carries the per-host `Referer`/`User-Agent` and routes TLS-fragile CDNs through
/// the worker; a failed playback retries once on the alternate leg.
private struct PrivateVideoPlaybackView: View {
    let url: URL
    var isActive: Bool
    /// Only show the transport card while the viewer's controls are visible.
    var showsControls = true
    var onSingleTap: (() -> Void)?

    @State private var player: AVPlayer?
    @State private var isPlaying = false
    @State private var isMuted = false
    @State private var currentTime: Double = 0
    @State private var duration: Double = 0
    @State private var isScrubbing = false
    @State private var timeObserver: Any?
    /// Set once the alternate route leg has been tried, so a dead URL cannot loop.
    @State private var didRetryAlternate = false

    var body: some View {
        ZStack {
            Color.black

            if let player {
                AVPlayerSurfaceView(player: player, videoGravity: .resizeAspect)
                    .ignoresSafeArea()
                    .onTapGesture { onSingleTap?() }
                    .overlay(alignment: .bottom) {
                        if isActive, showsControls {
                            playbackControls(player)
                                .padding(.horizontal, 16)
                                // Clears `ViewerScreen.bottomBar` (manga / favorite /
                                // info buttons) so the card never hides under it.
                                .padding(.bottom, 96)
                                .transition(.opacity)
                        }
                    }
            } else {
                ProgressView()
                    .tint(AppTheme.textPrimary)
            }
        }
        .onAppear(perform: setUp)
        .onDisappear(perform: tearDown)
        .onChange(of: url) { _, _ in
            tearDown()
            setUp()
        }
        .onChange(of: isActive) { _, active in
            guard let player else { return }
            if active {
                player.play()
                isPlaying = true
            } else {
                player.pause()
                isPlaying = false
            }
        }
    }

    /// Classic transport card: scrubber row (time / slider / duration) plus a
    /// button row (-10s / play-pause / +10s / mute), on a translucent surface.
    private func playbackControls(_ player: AVPlayer) -> some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Text(Self.timeLabel(currentTime))
                    .font(.caption2.monospacedDigit())
                    .frame(width: 38, alignment: .leading)

                Slider(
                    value: Binding(
                        get: { currentTime },
                        set: { currentTime = $0 }
                    ),
                    in: 0...max(duration, 0.1),
                    onEditingChanged: { editing in
                        isScrubbing = editing
                        if !editing {
                            player.seek(to: CMTime(seconds: currentTime, preferredTimescale: 600))
                        }
                    }
                )
                .tint(AppTheme.primary)

                Text(Self.timeLabel(duration))
                    .font(.caption2.monospacedDigit())
                    .frame(width: 38, alignment: .trailing)
            }

            HStack(spacing: 18) {
                circleControl(system: "gobackward.10") { seek(player, by: -10) }

                Button {
                    togglePlayback(player)
                } label: {
                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(AppTheme.textPrimary)
                        .frame(width: 48, height: 48)
                        .background(AppTheme.primary.opacity(0.9), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(isPlaying ? "Pause" : "Play")

                circleControl(system: "goforward.10") { seek(player, by: 10) }

                Spacer(minLength: 0)

                circleControl(system: isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill") {
                    toggleMute(player)
                }
            }
            .foregroundStyle(AppTheme.textPrimary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(AppTheme.surface.opacity(0.92), in: RoundedRectangle(cornerRadius: 16))
    }

    private func circleControl(system: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 17, weight: .semibold))
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Player lifecycle

    private func setUp() {
        guard player == nil else { return }
        didRetryAlternate = false
        let newPlayer = AVPlayer(playerItem: MediaRequestConfiguration.makePlayerItem(for: url))
        newPlayer.isMuted = isMuted
        player = newPlayer
        currentTime = 0
        duration = 0
        timeObserver = newPlayer.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
            queue: .main
        ) { time in
            // A relayed leg can fail mid-load; the alternate leg is tried once.
            if newPlayer.currentItem?.status == .failed {
                retryAlternateLeg()
                return
            }
            guard !isScrubbing else { return }
            let seconds = time.seconds
            if seconds.isFinite {
                currentTime = seconds
            }
            if let total = newPlayer.currentItem?.duration.seconds, total.isFinite, total > 0 {
                duration = total
            }
        }
        if isActive {
            newPlayer.play()
            isPlaying = true
        }
    }

    /// Swaps in the other route leg (direct ⇄ relay) after a playback failure so
    /// a TLS-fragile or relay-blocked source still plays. Runs at most once.
    private func retryAlternateLeg() {
        guard !didRetryAlternate, let player else { return }
        didRetryAlternate = true
        let attempts = MediaRequestConfiguration.routeAttempts(for: url)
        guard attempts.count > 1 else { return }
        let alternate = attempts[1]
        player.replaceCurrentItem(with: MediaRequestConfiguration.makePlayerItem(for: alternate))
        currentTime = 0
        duration = 0
        if isActive {
            player.play()
            isPlaying = true
        }
    }

    private func tearDown() {
        if let timeObserver, let player {
            player.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        player?.pause()
        player = nil
        isPlaying = false
    }

    private func togglePlayback(_ player: AVPlayer) {
        if isPlaying {
            player.pause()
            isPlaying = false
        } else {
            player.play()
            isPlaying = true
        }
    }

    private func toggleMute(_ player: AVPlayer) {
        isMuted.toggle()
        player.isMuted = isMuted
    }

    /// Relative seek (-10s / +10s), clamped to the clip bounds.
    private func seek(_ player: AVPlayer, by delta: Double) {
        let upperBound = duration > 0 ? duration : max(currentTime + delta, 0)
        let target = min(max(currentTime + delta, 0), upperBound)
        currentTime = target
        player.seek(to: CMTime(seconds: target, preferredTimescale: 600))
    }

    private static func timeLabel(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let total = Int(seconds.rounded())
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

// MARK: - Multi-page gallery / manga reader

/// Vertical reader for multi-page posts (nhentai / manga), with a page indicator
/// (RN `mangaPages` reader, ImageViewerModal.tsx:804-1620). Double tap zooms 2.2x
/// onto the tapped point and a second double tap returns to 1x without losing the
/// current page (RN `handleMangaDoubleTap`, ImageViewerModal.tsx:1439-1490).
private struct PrivateMangaReaderView: View {
    let pages: [URL]
    /// Post-level aspect ratio used when a page has no cached/source ratio.
    var aspectRatioFallback: Double?
    var onSingleTap: (() -> Void)?
    var onZoomChanged: ((Bool) -> Void)?

    @State private var visiblePageID: Int?
    @State private var zoomScale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var zoomOffset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero
    @State private var zoomAnchor: UnitPoint = .center

    private static let zoomEpsilon: CGFloat = 1.01
    /// RN `tapZoom` for the manga reader (ImageViewerModal.tsx:1469).
    private static let doubleTapScale: CGFloat = 2.2

    /// Guards against zero/NaN post ratios so a page always reserves a height.
    private static func validRatio(_ value: Double?) -> Double? {
        guard let value, value.isFinite, value > 0.05 else { return nil }
        return value
    }

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size

            ZStack(alignment: .bottomTrailing) {
                ScrollView(.vertical) {
                    LazyVStack(spacing: 0) {
                        ForEach(pages.indices, id: \.self) { index in
                            let url = pages[index]
                            // Reserve the page's exact height before its image arrives,
                            // so fast scrolling never reflows the reader.
                            let ratio = MediaAspectRatioCache.aspectRatio(for: url)
                                ?? Self.validRatio(aspectRatioFallback)
                                ?? 0.707

                            Color.clear
                                .aspectRatio(CGFloat(ratio), contentMode: .fit)
                                .overlay {
                                    PrivateViewerImage(
                                        urls: [url],
                                        failureText: "Page \(index + 1) unavailable"
                                    )
                                }
                                .frame(maxWidth: .infinity)
                                .id(index)
                                .onAppear {
                                    let upcoming = Array(pages.dropFirst(index + 1).prefix(6))
                                    guard !upcoming.isEmpty else { return }
                                    Task {
                                        await MediaImageLoader.shared.prefetch(urls: upcoming)
                                    }
                                }
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollPosition(id: $visiblePageID)
                .scrollIndicators(.visible)
                // The zoom pan owns the touch while zoomed; scrolling returns at 1x.
                .scrollDisabled(zoomScale > Self.zoomEpsilon)
                .contentShape(Rectangle())
                .scaleEffect(zoomScale, anchor: zoomAnchor)
                .offset(zoomOffset)
                .simultaneousGesture(
                    panGesture(size: size),
                    including: zoomScale > Self.zoomEpsilon ? .all : .none
                )
                .gesture(tapGesture(size: size))

                Text("\((visiblePageID ?? 0) + 1) / \(pages.count)")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(16)
            }
            .clipped()
            .onChange(of: zoomScale) { _, scale in
                onZoomChanged?(scale > Self.zoomEpsilon)
            }
            .onDisappear {
                onZoomChanged?(false)
            }
        }
    }

    private func panGesture(size: CGSize) -> some Gesture {
        DragGesture()
            .onChanged { value in
                guard zoomScale > Self.zoomEpsilon else { return }
                let moved = CGSize(
                    width: lastOffset.width + value.translation.width,
                    height: lastOffset.height + value.translation.height
                )
                zoomOffset = clampZoomOffset(moved, scale: zoomScale, anchor: zoomAnchor, size: size)
            }
            .onEnded { _ in
                if zoomScale > Self.zoomEpsilon {
                    lastOffset = zoomOffset
                } else {
                    resetZoom()
                }
            }
    }

    private func tapGesture(size: CGSize) -> some Gesture {
        SpatialTapGesture(count: 2)
            .onEnded { value in
                handleDoubleTap(at: value.location, in: size)
            }
            .exclusively(
                before: TapGesture(count: 1).onEnded { _ in
                    onSingleTap?()
                }
            )
    }

    private func handleDoubleTap(at location: CGPoint, in size: CGSize) {
        withAnimation(.easeInOut(duration: 0.2)) {
            if zoomScale > Self.zoomEpsilon {
                resetZoom()
            } else {
                guard size.width > 0, size.height > 0 else { return }
                zoomAnchor = UnitPoint(
                    x: min(max(location.x / size.width, 0), 1),
                    y: min(max(location.y / size.height, 0), 1)
                )
                zoomScale = Self.doubleTapScale
                lastScale = Self.doubleTapScale
                zoomOffset = .zero
                lastOffset = .zero
            }
        }
    }

    private func resetZoom() {
        zoomScale = 1
        lastScale = 1
        zoomOffset = .zero
        lastOffset = .zero
        zoomAnchor = .center
    }
}
