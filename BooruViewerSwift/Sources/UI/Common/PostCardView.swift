import AVKit
import Foundation
import SwiftUI

/// One masonry-grid post card, mirroring RN `PostCard`
/// (src/components/PostCard.tsx:253-372).
///
/// The card keeps RN's presentation rules:
/// - aspect ratio clamped to 0.6...1.4 with a 0.75 fallback (PostCard.tsx:84);
/// - a cheap static cover (`previewUrl`, then the poster/thumbnail/quality fallbacks);
/// - inline motion only when grid previews are enabled: a muted looping listing clip
///   (`GridPreviewPolicy.videoCandidates`) or the 1200 ms frame slideshow
///   (`GridPreviewPolicy.frameCandidates` + `GridPreviewTiming`);
/// - rating, score, sound, media-type and favorite badges.
struct PostCardView: View {
    /// One corner badge (manga/webm/gif/mp4/zip/video), PostCard.tsx:346-362.
    private struct MediaBadge {
        let text: String
        let symbol: String?
    }

    private let post: BooruPost
    private let imageQuality: ImageQuality
    private let gridPreviewsEnabled: Bool
    private let isFavorite: Bool
    private let onTap: () -> Void
    private let onLongPress: (() -> Void)?

    /// Gates motion so off-screen cards never hold a player or a timer (PostCard.tsx:127-129).
    @State private var isOnScreen = false
    /// Index into the frame slideshow (PostCard.tsx:111, 192-200).
    @State private var frameIndex = 0
    /// Explicit hold on the card, from the moment the long press succeeds until the
    /// finger lifts (RN `touchPreviewActive`, PostCard.tsx:110, 261-268).
    @State private var isPressing = false
    /// Guards the long-press callback so one hold fires it exactly once.
    @State private var didLongPress = false

    init(
        post: BooruPost,
        imageQuality: ImageQuality,
        gridPreviewsEnabled: Bool,
        isFavorite: Bool = false,
        onTap: @escaping () -> Void,
        onLongPress: (() -> Void)? = nil
    ) {
        self.post = post
        self.imageQuality = imageQuality
        self.gridPreviewsEnabled = gridPreviewsEnabled
        self.isFavorite = isFavorite
        self.onTap = onTap
        self.onLongPress = onLongPress
    }

    // MARK: Geometry

    /// RN clamp (PostCard.tsx:84): `max(0.6, min(1.4, aspectRatio || 0.75))`.
    private var aspectRatio: Double {
        let raw = post.aspectRatio > 0 ? post.aspectRatio : 0.75
        return min(1.4, max(0.6, raw))
    }

    // MARK: Cover

    /// Static cover: preview first so no video container reaches the image loader
    /// (PostCard.tsx:52-57, 96-99), then the requested quality's image URL.
    private var coverURL: URL? {
        ImageQualityResolver.placeholderURL(for: post)
            ?? ImageQualityResolver.imageURL(for: post, quality: imageQuality)
    }

    /// Poster, thumbnail, then the quality image (PostCard.tsx:101-105).
    private var coverFallbacks: [URL] {
        var result: [URL] = []
        let candidates: [URL?] = [
            post.previewFallbackURL,
            post.previewThumbURL,
            ImageQualityResolver.imageURL(for: post, quality: imageQuality),
        ]
        for candidate in candidates {
            guard let url = MediaURLNormalizer.normalize(candidate, sourceID: post.sourceID) else { continue }
            if !result.contains(url) { result.append(url) }
        }
        return result
    }

    // MARK: Inline motion

    /// Master switch, on-screen gate, and "has something to show" (PostCard.tsx:125-129).
    private var canPlayInline: Bool {
        isOnScreen && GridPreviewPolicy.shouldPlayInlinePreview(
            post: post,
            enabled: gridPreviewsEnabled,
            quality: imageQuality
        )
    }

    /// RN `hasPreview` (PostCard.tsx:125): a hold-widened clip or a frame source.
    private var hasPreview: Bool {
        !GridPreviewPolicy.videoCandidates(
            for: post,
            quality: imageQuality,
            allowOriginal: true
        ).isEmpty || !GridPreviewPolicy.frameCandidates(for: post).isEmpty
    }

    /// Motion runs for on-screen cards and, additionally, while the card is held
    /// (PostCard.tsx:126-129, 146).
    private var isPreviewActive: Bool {
        canPlayInline || (isPressing && isOnScreen && gridPreviewsEnabled && hasPreview)
    }

    /// Automatic listing clip. A hold widens the candidates to the full original,
    /// which is RN's explicit-hold path (`allowOriginal`, PostCard.tsx:146).
    private var videoURL: URL? {
        guard isPreviewActive else { return nil }
        return GridPreviewPolicy.videoCandidates(
            for: post,
            quality: imageQuality,
            allowOriginal: isPressing
        ).first
    }

    /// Frame slideshow sources for videoless cards (PostCard.tsx:119-124).
    private var frames: [URL] {
        guard isPreviewActive else { return [] }
        return GridPreviewPolicy.frameCandidates(for: post)
    }

    /// Only a multi-frame slideshow needs the timer.
    private var frameLoopKey: Int {
        guard videoURL == nil, frames.count > 1 else { return 0 }
        return frames.count
    }

    private var currentFrame: URL? {
        guard !frames.isEmpty else { return nil }
        return frames[frameIndex % frames.count]
    }

    var body: some View {
        Color.clear
            .aspectRatio(CGFloat(aspectRatio), contentMode: .fit)
            .overlay {
                ZStack {
                    AsyncMediaImage(url: coverURL, fallbackURLs: coverFallbacks, contentMode: .fill)

                    if let videoURL {
                        MutedLoopingVideo(url: videoURL)
                            .id(videoURL)
                    } else if let currentFrame {
                        AsyncMediaImage(url: currentFrame, contentMode: .fill)
                            .id(currentFrame)
                    }

                    LinearGradient(
                        colors: [Color.black.opacity(0.02), Color.black.opacity(0.38)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .allowsHitTesting(false)

                    topBadges
                    bottomBadges
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(AppTheme.border, lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .onLongPressGesture(
                minimumDuration: 0.35,
                maximumDistance: 50,
                pressing: handlePressingChange,
                perform: beginHoldPreview
            )
            .simultaneousGesture(
                // A succeeded `LongPressGesture` reports `pressing == false` at
                // 0.35 s — finger still down — and never reports the real lift, so
                // this zero-distance drag supplies RN's `onPressOut`
                // (PostCard.tsx:268).
                DragGesture(minimumDistance: 0)
                    .onEnded { _ in endHoldPreview() }
            )
            .onTapGesture(perform: onTap)
            .onAppear { isOnScreen = true }
            .onDisappear {
                isOnScreen = false
                endHoldPreview()
            }
            .task(id: frameLoopKey) {
                guard frameLoopKey > 0 else {
                    frameIndex = 0
                    return
                }
                while !Task.isCancelled {
                    do {
                        try await Task.sleep(
                            nanoseconds: UInt64(GridPreviewTiming.frameIntervalMilliseconds) * 1_000_000
                        )
                    } catch {
                        return
                    }
                    frameIndex = GridPreviewTiming.nextFrameIndex(
                        current: frameIndex,
                        frameCount: frames.count
                    )
                }
            }
    }

    // MARK: Press / long press

    /// `pressing` turns `true` at touch-down but back to `false` when the hold
    /// *succeeds* (at `minimumDuration`, finger still down), so it only cancels a
    /// hold that never completed; the real release arrives from the
    /// zero-distance drag in `body`.
    private func handlePressingChange(_ pressing: Bool) {
        guard !pressing, !didLongPress else { return }
        endHoldPreview()
    }

    /// The hold reached 0.35 s: raise the inline preview and notify once
    /// (PostCard.tsx:261-267).
    private func beginHoldPreview() {
        guard !didLongPress else { return }
        didLongPress = true
        if isOnScreen && gridPreviewsEnabled && hasPreview {
            isPressing = true
        }
        onLongPress?()
    }

    /// Finger up, or the card left the grid: stop the held preview and reset
    /// (RN `onPressOut`, PostCard.tsx:268).
    private func endHoldPreview() {
        guard isPressing || didLongPress else { return }
        isPressing = false
        didLongPress = false
    }

    // MARK: Badges

    private var topBadges: some View {
        HStack(alignment: .top, spacing: 6) {
            if isFavorite {
                Image(systemName: "heart.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.white)
                    .frame(width: 26, height: 26)
                    .background(Color.black.opacity(0.6), in: Circle())
                    .allowsHitTesting(false)
            }
            Spacer(minLength: 0)
            if let mediaBadge {
                mediaBadgeView(mediaBadge)
            }
        }
        .padding(.horizontal, 8)
        .padding(.top, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .allowsHitTesting(false)
    }

    private var bottomBadges: some View {
        HStack(spacing: 6) {
            Text(post.rating.rawValue.uppercased())
                .font(.system(size: 10, weight: .heavy))
                .foregroundStyle(Color.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(AppTheme.ratingColor(for: post.rating), in: RoundedRectangle(cornerRadius: 6))

            if hasSoundTag {
                Image(systemName: "speaker.wave.2.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 3)
                    .background(Color.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 6))
            }

            Spacer(minLength: 0)

            if post.score != 0 {
                Text("★ \(post.score)")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(AppTheme.goldAccent)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .allowsHitTesting(false)
    }

    /// RedGifs carries audio support as the `sound` meta tag; grid clips play muted
    /// (PostCard.tsx:337-343).
    private var hasSoundTag: Bool {
        post.tags.meta.contains("sound")
    }

    /// Manga page count first, then WEBM, then gif/mp4/zip, then a generic video mark
    /// (PostCard.tsx:346-362).
    private var mediaBadge: MediaBadge? {
        if post.sourceID == .nhentai || (post.pageCount ?? 0) > 0 {
            let text = post.pageCount.map { "\($0)P" } ?? "MANGA"
            return MediaBadge(text: text, symbol: "book.fill")
        }
        if isWebm {
            return MediaBadge(text: "WEBM", symbol: nil)
        }
        if let ext = post.fileExt?.lowercased(), ["gif", "mp4", "zip", "webp"].contains(ext) {
            return MediaBadge(text: ext.uppercased(), symbol: nil)
        }
        if post.previewVideoURL != nil {
            return MediaBadge(text: "VIDEO", symbol: "play.fill")
        }
        return nil
    }

    /// RN `isWebm` (PostCard.tsx:87-93).
    private var isWebm: Bool {
        if post.fileExt?.lowercased() == "webm" { return true }
        return endsWith(post.originalURL, ".webm") || endsWith(post.sampleURL, ".webm")
    }

    private func mediaBadgeView(_ badge: MediaBadge) -> some View {
        HStack(spacing: 3) {
            if let symbol = badge.symbol {
                Image(systemName: symbol)
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(Color.white)
            }
            Text(badge.text)
                .font(.system(size: 9, weight: .heavy))
                .foregroundStyle(Color.white)
        }
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(badgeFill(badge), in: RoundedRectangle(cornerRadius: 4))
    }

    /// Manga red, WEBM orange (AVPlayer cannot decode it), other types near-black
    /// (PostCard.tsx:548-573).
    private func badgeFill(_ badge: MediaBadge) -> Color {
        if badge.symbol == "book.fill" { return AppTheme.color(0xED2553, opacity: 0.85) }
        if badge.text == "WEBM" { return AppTheme.color(0xE65100, opacity: 0.9) }
        return Color.black.opacity(0.7)
    }

    /// RN `pathOf(...).endsWith(...)`; query strings and fragments are ignored.
    private func endsWith(_ url: URL?, _ suffix: String) -> Bool {
        guard let raw = url?.absoluteString.lowercased() else { return false }
        let path = raw.split(whereSeparator: { $0 == "?" || $0 == "#" }).first.map { String($0) } ?? raw
        return path.hasSuffix(suffix)
    }
}

/// Muted, looping inline clip.
///
/// `AVPlayerLooper` owns the loop so no end-of-item notification has to be wired up,
/// and the player is paused as soon as the card leaves the grid (RN releases the
/// native player for the same reason, PostCard.tsx:397-408).
private struct MutedLoopingVideo: View {
    let url: URL

    @State private var player: AVQueuePlayer?
    @State private var looper: AVPlayerLooper?

    var body: some View {
        VideoPlayer(player: player)
            .allowsHitTesting(false)
            .disabled(true)
            .onAppear(perform: start)
            .onDisappear(perform: stop)
    }

    private func start() {
        if let player {
            player.play()
            return
        }
        let item = AVPlayerItem(url: url)
        let queuePlayer = AVQueuePlayer()
        queuePlayer.isMuted = true
        looper = AVPlayerLooper(player: queuePlayer, templateItem: item)
        player = queuePlayer
        queuePlayer.play()
    }

    private func stop() {
        player?.pause()
    }
}
