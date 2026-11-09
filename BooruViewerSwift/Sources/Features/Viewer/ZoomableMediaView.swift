import SwiftUI
import AVKit
import Foundation

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
                    onSingleTap: onSingleTap,
                    onZoomChanged: onZoomChanged
                )
            } else if let videoURL = media?.videoURL {
                PrivateVideoPlaybackView(url: videoURL, isActive: isActive, onSingleTap: onSingleTap)
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

            ZStack {
                Color.black

                if let url = media?.imageURL ?? media?.placeholderURL {
                    AsyncImage(url: url) { phase in
                        switch phase {
                        case .empty:
                            ProgressView()
                                .tint(AppTheme.textPrimary)
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFit()
                                .frame(width: size.width, height: size.height)
                        case .failure:
                            unavailable
                        @unknown default:
                            unavailable
                        }
                    }
                } else {
                    unavailable
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
private struct PrivateVideoPlaybackView: View {
    let url: URL
    var isActive: Bool
    var onSingleTap: (() -> Void)?

    @State private var player: AVPlayer?
    @State private var isPlaying = false
    @State private var isMuted = false
    @State private var currentTime: Double = 0
    @State private var duration: Double = 0
    @State private var isScrubbing = false
    @State private var timeObserver: Any?

    var body: some View {
        ZStack {
            Color.black

            if let player {
                VideoPlayer(player: player)
                    .ignoresSafeArea()
                    .onTapGesture { onSingleTap?() }
                    .overlay(alignment: .bottom) {
                        if isActive {
                            playbackControls(player)
                                .padding(.horizontal, 16)
                                .padding(.bottom, 24)
                        }
                    }
            } else {
                ProgressView()
                    .tint(AppTheme.textPrimary)
            }
        }
        .onAppear(perform: setUp)
        .onDisappear(perform: tearDown)
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

    private func playbackControls(_ player: AVPlayer) -> some View {
        VStack(spacing: 6) {
            HStack(spacing: 10) {
                Button {
                    togglePlayback(player)
                } label: {
                    Image(systemName: isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .frame(width: 32, height: 32)
                }

                Text(Self.timeLabel(currentTime))
                    .font(.caption2.monospacedDigit())

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

                Button {
                    toggleMute(player)
                } label: {
                    Image(systemName: isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 32, height: 32)
                }
            }
            .foregroundStyle(AppTheme.textPrimary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }

    // MARK: Player lifecycle

    private func setUp() {
        guard player == nil else { return }
        let newPlayer = AVPlayer(playerItem: AVPlayerItem(url: url))
        newPlayer.isMuted = isMuted
        player = newPlayer
        currentTime = 0
        duration = 0
        timeObserver = newPlayer.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.5, preferredTimescale: 600),
            queue: .main
        ) { time in
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

    private static func timeLabel(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let total = Int(seconds.rounded())
        return String(format: "%ld:%02ld", total / 60, total % 60)
    }
}

// MARK: - Multi-page gallery / manga reader

/// Vertical reader for multi-page posts (nhentai / manga), with a page indicator
/// (RN `mangaPages` reader, ImageViewerModal.tsx:804-1620). Double tap zooms 2.2x
/// onto the tapped point and a second double tap returns to 1x without losing the
/// current page (RN `handleMangaDoubleTap`, ImageViewerModal.tsx:1439-1490).
private struct PrivateMangaReaderView: View {
    let pages: [URL]
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

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size

            ZStack(alignment: .bottomTrailing) {
                ScrollView(.vertical) {
                    LazyVStack(spacing: 0) {
                        ForEach(pages.indices, id: \.self) { index in
                            let url = pages[index]

                            AsyncImage(url: url) { phase in
                                switch phase {
                                case .empty:
                                    ProgressView()
                                        .tint(AppTheme.textPrimary)
                                        .frame(maxWidth: .infinity, minHeight: 240)
                                case .success(let image):
                                    image
                                        .resizable()
                                        .scaledToFit()
                                        .frame(maxWidth: .infinity)
                                case .failure:
                                    VStack(spacing: 8) {
                                        Image(systemName: "exclamationmark.triangle")
                                        Text("Page \(index + 1) unavailable")
                                            .font(.footnote)
                                    }
                                    .foregroundStyle(AppTheme.textSecondary)
                                    .frame(maxWidth: .infinity, minHeight: 240)
                                @unknown default:
                                    EmptyView()
                                }
                            }
                            .id(index)
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
