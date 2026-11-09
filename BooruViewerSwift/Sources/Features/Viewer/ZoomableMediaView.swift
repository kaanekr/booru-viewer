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

    var body: some View {
        Group {
            if isMangaMode, galleryPages.count > 1 {
                PrivateMangaReaderView(pages: galleryPages, onSingleTap: onSingleTap)
            } else if let videoURL = media?.videoURL {
                PrivateVideoPlaybackView(url: videoURL, isActive: isActive, onSingleTap: onSingleTap)
            } else {
                imagePage
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Image page (pinch + double-tap zoom)

    private var imagePage: some View {
        GeometryReader { proxy in
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
                                .frame(width: proxy.size.width, height: proxy.size.height)
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
            .frame(width: proxy.size.width, height: proxy.size.height)
            .scaleEffect(zoomScale)
            .offset(zoomOffset)
            .contentShape(Rectangle())
            .gesture(magnificationGesture)
            .simultaneousGesture(panGesture, including: zoomScale > 1.01 ? .all : .none)
            .gesture(tapGesture)
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

    private var magnificationGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                zoomScale = min(max(1, lastScale * value.magnification), 4)
            }
            .onEnded { _ in
                lastScale = zoomScale
                if zoomScale <= 1.01 {
                    resetZoom()
                }
            }
    }

    /// Only pans while zoomed in: the gesture is masked out at 1x so horizontal
    /// drags pass straight through to the paged `TabView`.
    private var panGesture: some Gesture {
        DragGesture()
            .onChanged { value in
                guard zoomScale > 1.01 else { return }
                zoomOffset = CGSize(
                    width: lastOffset.width + value.translation.width,
                    height: lastOffset.height + value.translation.height
                )
            }
            .onEnded { _ in
                if zoomScale > 1.01 {
                    lastOffset = zoomOffset
                } else {
                    resetZoom()
                }
            }
    }

    /// Double tap zooms, a single tap toggles the controls. `exclusively` keeps the
    /// double tap from also firing the single-tap handler.
    private var tapGesture: some Gesture {
        TapGesture(count: 2)
            .onEnded { _ in handleDoubleTap() }
            .exclusively(
                before: TapGesture(count: 1).onEnded { _ in
                    guard let onSingleTap = onSingleTap else { return }
                    onSingleTap()
                }
            )
    }

    private func handleDoubleTap() {
        withAnimation(.easeInOut(duration: 0.2)) {
            if zoomScale > 1 {
                zoomScale = 1
                lastScale = 1
                zoomOffset = .zero
                lastOffset = .zero
            } else {
                zoomScale = 2.5
                lastScale = 2.5
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
    }
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
/// (RN `mangaPages` reader, ImageViewerModal.tsx:804-1620).
private struct PrivateMangaReaderView: View {
    let pages: [URL]
    var onSingleTap: (() -> Void)?

    @State private var visiblePageID: Int?

    var body: some View {
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
            .contentShape(Rectangle())
            .onTapGesture { onSingleTap?() }

            Text("\((visiblePageID ?? 0) + 1) / \(pages.count)")
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppTheme.textPrimary)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(.ultraThinMaterial, in: Capsule())
                .padding(16)
        }
    }
}
