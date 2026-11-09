import Foundation
import Observation

/// Drives the full-screen media viewer: per-post `ResolvedMedia` cache, recent-view
/// recording, favorite toggling and favorite-tag / blacklist pinning.
///
/// Mirrors RN `ImageViewerModal` state (src/components/ImageViewerModal.tsx) and the
/// tag menu actions of `PostInfoModal` (src/components/PostInfoModal.tsx).
@MainActor
@Observable
final class ViewerViewModel {
    // MARK: Inputs

    let posts: [BooruPost]
    /// Per-request dependencies handed to every `BooruSource`.
    let context: SourceContext

    // MARK: Observable state

    /// Index of the visible post. Kept in sync with the paged `TabView`.
    var currentIndex: Int
    /// Transient toast, cleared automatically after 2.2s (RN `setTimeout` 2200).
    var toastMessage: String?
    /// nhentai-style multi-page reader toggle. Only meaningful when the visible
    /// post is an nhentai gallery with more than one page.
    var isMangaMode = false

    private(set) var mediaByKey: [String: ResolvedMedia] = [:]
    private(set) var loadingKeys: Set<String> = []
    /// Gallery pages per post, resolved from the source (`NHentaiSource.galleryPages`).
    private(set) var galleryPagesByKey: [String: [URL]] = [:]
    private(set) var loadingGalleryKeys: Set<String> = []
    private(set) var favoriteKeys: Set<String> = []
    private(set) var savingFavorite = false
    private(set) var pinnedTags: Set<String> = []
    private(set) var blacklistedTagNames: Set<String> = []

    // MARK: Dependencies

    @ObservationIgnored private let sourceProvider: @Sendable (SourceID) -> (any BooruSource)?
    @ObservationIgnored private let recentViews: (any RecentViewsStoring)?
    @ObservationIgnored private let favorites: (any FavoritesStoring)?
    @ObservationIgnored private let favoriteTagStore: (any TagListStoring)?
    @ObservationIgnored private let blacklistStore: (any TagListStoring)?

    /// Generation counter for `contains` checks (RN `favoriteRequestRef`,
    /// ImageViewerModal.tsx:130, 215-224).
    @ObservationIgnored private var favoriteRequest = 0
    /// Last post recorded in recent views, so the focused viewer does not rewrite
    /// the same entry on every re-render (ImageViewerModal.tsx:55-59).
    @ObservationIgnored private var lastRecordedKey: String?
    @ObservationIgnored private var toastTask: Task<Void, Never>?

    init(
        posts: [BooruPost],
        initialIndex: Int = 0,
        context: SourceContext,
        sourceProvider: @escaping @Sendable (SourceID) -> (any BooruSource)? = { SourceRegistry.source(for: $0) },
        recentViews: (any RecentViewsStoring)? = nil,
        favorites: (any FavoritesStoring)? = nil,
        favoriteTags: (any TagListStoring)? = nil,
        blacklistedTags: (any TagListStoring)? = nil
    ) {
        self.posts = posts
        self.context = context
        self.sourceProvider = sourceProvider
        self.recentViews = recentViews
        self.favorites = favorites
        self.favoriteTagStore = favoriteTags
        self.blacklistStore = blacklistedTags
        self.currentIndex = posts.indices.contains(initialIndex) ? initialIndex : 0
    }

    // MARK: Current post

    var currentPost: BooruPost? {
        posts.indices.contains(currentIndex) ? posts[currentIndex] : posts.first
    }

    /// RN `isVideoPost` (src/utils/media.ts).
    nonisolated static func isVideoPost(_ post: BooruPost) -> Bool {
        !VideoCandidateSelector.videoCandidates(for: post).isEmpty
    }

    /// Multi-page gallery pages (nhentai / manga), resolved lazily per post and cached
    /// in `galleryPagesByKey`. Only nhentai galleries have pages: `previewThumbs` are
    /// video trailer frames (Pornhub) and must never be treated as a manga.
    func galleryPages(for post: BooruPost) -> [URL] {
        guard post.sourceID == .nhentai else { return [] }
        return galleryPagesByKey[postKey(post)] ?? []
    }

    /// True when the visible post has more than one gallery page to read.
    var canShowMangaMode: Bool {
        guard let post = currentPost else { return false }
        return galleryPages(for: post).count > 1
    }

    /// Share target: the post page first, then the media itself.
    func shareURL(for post: BooruPost) -> URL? {
        post.sourceLink ?? post.originalURL ?? post.sampleURL ?? post.previewURL
    }

    // MARK: Media resolution

    func media(for post: BooruPost) -> ResolvedMedia? {
        mediaByKey[postKey(post)]
    }

    func isLoading(_ post: BooruPost) -> Bool {
        loadingKeys.contains(postKey(post))
    }

    /// Resolves and caches the gallery pages of one post. Only nhentai has a paged
    /// gallery; a cancelled or failed load is deliberately left uncached so swiping
    /// back to the post retries instead of showing an empty reader forever.
    func loadGalleryPages(for post: BooruPost) async {
        guard post.sourceID == .nhentai else { return }
        let key = postKey(post)
        guard galleryPagesByKey[key] == nil, !loadingGalleryKeys.contains(key) else { return }
        loadingGalleryKeys.insert(key)
        defer { loadingGalleryKeys.remove(key) }

        let source = (sourceProvider(post.sourceID) as? NHentaiSource) ?? NHentaiSource()
        do {
            let pages = try await source.galleryPages(for: post, context: context)
            guard !Task.isCancelled else { return }
            galleryPagesByKey[key] = pages
        } catch {
            return
        }
    }

    /// Resolves and caches the media for `post`. Falls back to the pure URL rules
    /// (`ImageQualityResolver` + `VideoCandidateSelector`) when the source cannot be
    /// resolved or fails, so the viewer always has something to show.
    func loadMedia(for post: BooruPost) async {
        let key = postKey(post)
        guard mediaByKey[key] == nil, !loadingKeys.contains(key) else { return }
        loadingKeys.insert(key)
        defer { loadingKeys.remove(key) }

        // nhentai's gallery detail is already fetched for the manga reader, so reuse it
        // instead of issuing the same request twice (`NHentaiSource.resolveMedia` uses
        // the same "first page, else listing cover" rule).
        if post.sourceID == .nhentai, let pages = galleryPagesByKey[key] {
            let resolved = ResolvedMedia(
                imageURL: pages.first ?? post.previewURL,
                videoURL: nil,
                isVideo: false,
                placeholderURL: ImageQualityResolver.placeholderURL(for: post)
            )
            guard let media = await playable(resolved, post: post) else { return }
            mediaByKey[key] = media
            return
        }

        if let source = sourceProvider(post.sourceID) {
            do {
                let resolved = try await source.resolveMedia(for: post, context: context)
                guard let media = await playable(resolved, post: post) else { return }
                mediaByKey[key] = media
                return
            } catch {
                // A cancelled load must not cache the fallback: leaving `mediaByKey[key]`
                // nil is what lets the post retry when the user swipes back to it.
                if error is CancellationError || Task.isCancelled { return }
            }
        }

        let fallback = Self.fallbackMedia(for: post, quality: context.imageQuality)
        guard let media = await playable(fallback, post: post) else { return }
        mediaByKey[key] = media
    }

    /// Prefetches the next two and previous one posts (ImageViewerModal.tsx:226-249).
    func prefetchNeighbors() {
        for offset in [1, 2, -1] {
            let index = currentIndex + offset
            guard posts.indices.contains(index) else { continue }
            let post = posts[index]
            Task {
                // nhentai pages first: `loadMedia` reuses the cached gallery detail.
                await loadGalleryPages(for: post)
                await loadMedia(for: post)
            }
        }
    }

    /// Pure image/video choice for one post, used when a source is unavailable.
    nonisolated static func fallbackMedia(for post: BooruPost, quality: ImageQuality) -> ResolvedMedia {
        let video = VideoCandidateSelector.videoCandidates(for: post).first
        return ResolvedMedia(
            imageURL: ImageQualityResolver.imageURL(for: post, quality: quality),
            videoURL: video,
            isVideo: video != nil,
            placeholderURL: ImageQualityResolver.placeholderURL(for: post)
        )
    }

    /// WebM → MP4 upgrade (RN `checkMp4UpgradeAvailable`, ImageViewerModal.tsx) and
    /// `isVideo` kept consistent with the URL that actually survived. Returns `nil`
    /// when the surrounding task was cancelled, so the caller caches nothing.
    private func playable(_ resolved: ResolvedMedia, post: BooruPost) async -> ResolvedMedia? {
        var out = resolved
        if let video = out.videoURL, Self.isWebMPath(video) {
            if let upgraded = await MP4Upgrade.upgradedURL(for: video, http: context.http) {
                out.videoURL = upgraded
            } else {
                // AVPlayer cannot decode WebM (-11828): fall through to the still image.
                out.videoURL = nil
            }
            // `MP4Upgrade` performs a network probe: a cancelled viewer must not cache it.
            if Task.isCancelled { return nil }
        }
        out.isVideo = out.videoURL != nil
        if out.placeholderURL == nil {
            out.placeholderURL = ImageQualityResolver.placeholderURL(for: post)
        }
        if !out.isVideo, out.imageURL == nil {
            out.imageURL = ImageQualityResolver.imageURL(for: post, quality: context.imageQuality)
        }
        return out
    }

    private static func isWebMPath(_ url: URL) -> Bool {
        let raw = url.absoluteString.lowercased()
        let path = raw.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? raw
        return path.hasSuffix(".webm")
    }

    /// Everything the viewer needs when the visible page changes: record the view,
    /// re-read the favorite state, resolve media and prefetch neighbours
    /// (ImageViewerModal.tsx:157-249).
    func prepareCurrentPage() async {
        await recordViewIfNeeded()
        await refreshFavorite()
        if let post = currentPost {
            await loadGalleryPages(for: post)
            if !canShowMangaMode {
                isMangaMode = false
            }
            await loadMedia(for: post)
        }
        prefetchNeighbors()
    }

    // MARK: Recent views

    /// Records the visible post once per navigation step (ImageViewerModal.tsx:55-59).
    func recordViewIfNeeded() async {
        guard let post = currentPost else { return }
        let key = postKey(post)
        guard lastRecordedKey != key else { return }
        lastRecordedKey = key
        guard let recentViews else { return }
        try? await recentViews.record(post)
    }

    // MARK: Favorites

    func isFavorite(_ post: BooruPost) -> Bool {
        favoriteKeys.contains(postKey(post))
    }

    /// Re-reads the favorite state of the visible post (ImageViewerModal.tsx:215-224).
    func refreshFavorite() async {
        guard let post = currentPost else { return }
        favoriteRequest += 1
        let request = favoriteRequest
        let key = postKey(post)
        favoriteKeys.remove(key)
        guard let favorites else { return }
        guard let value = try? await favorites.contains(post), request == favoriteRequest else { return }
        if value { favoriteKeys.insert(key) } else { favoriteKeys.remove(key) }
    }

    /// Toggles the visible post, guarding against double writes
    /// (ImageViewerModal.tsx:330-346).
    func toggleFavorite() async {
        guard let post = currentPost, let favorites, !savingFavorite else { return }
        let key = postKey(post)
        let wasFavorite = favoriteKeys.contains(key)
        savingFavorite = true
        defer { savingFavorite = false }
        do {
            if wasFavorite {
                try await favorites.remove(id: post.id, sourceID: post.sourceID)
                favoriteKeys.remove(key)
            } else {
                try await favorites.add(post)
                favoriteKeys.insert(key)
            }
        } catch {
            showToast("Could not save favorite. Your saved posts have not been changed.")
        }
    }

    // MARK: Tag lists

    /// Loads both tag lists once so the info sheet can show pinned/blacklisted state.
    func loadTagLists() async {
        if let favoriteTagStore, let tags = try? await favoriteTagStore.list() {
            pinnedTags = Set(tags.map(Self.favoriteTagKey))
        }
        if let blacklistStore, let tags = try? await blacklistStore.list() {
            blacklistedTagNames = Set(tags.map(Self.blacklistTagKey))
        }
    }

    func isPinnedTag(_ tag: String) -> Bool {
        pinnedTags.contains(Self.favoriteTagKey(tag))
    }

    func isBlacklistedTag(_ tag: String) -> Bool {
        blacklistedTagNames.contains(Self.blacklistTagKey(tag))
    }

    /// Pin / unpin a tag in favorite tags (PostInfoModal.tsx:379-385).
    func togglePinnedTag(_ tag: String) async {
        let key = Self.favoriteTagKey(tag)
        guard !key.isEmpty else { return }
        guard let favoriteTagStore else {
            showToast("Favorite tags are unavailable.")
            return
        }
        let pinned = pinnedTags.contains(key)
        do {
            if pinned {
                try await favoriteTagStore.remove(tag)
                pinnedTags.remove(key)
                showToast("\"\(tag)\" removed from favorites.")
            } else {
                try await favoriteTagStore.add(tag)
                pinnedTags.insert(key)
                showToast("⭐ \"\(tag)\" added to favorite tags!")
            }
        } catch {
            showToast("Could not update favorite tags.")
        }
    }

    /// Add / remove a tag from the blacklist (PostInfoModal.tsx:387-393).
    func toggleBlacklistedTag(_ tag: String) async {
        let key = Self.blacklistTagKey(tag)
        guard !key.isEmpty else { return }
        guard let blacklistStore else {
            showToast("Blacklist is unavailable.")
            return
        }
        let blacklisted = blacklistedTagNames.contains(key)
        do {
            if blacklisted {
                try await blacklistStore.remove(tag)
                blacklistedTagNames.remove(key)
                showToast("\"\(tag)\" removed from blacklist.")
            } else {
                try await blacklistStore.add(tag)
                blacklistedTagNames.insert(key)
                showToast("🚫 \"\(tag)\" added to blacklist!")
            }
        } catch {
            showToast("Could not update the blacklist.")
        }
    }

    // MARK: Toast

    func showToast(_ message: String) {
        toastMessage = message
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_200_000_000)
            guard !Task.isCancelled else { return }
            self?.toastMessage = nil
        }
    }

    // MARK: Tag key normalization

    /// Mirrors `TagListStore.favorite` normalization: trimmed, whitespace collapsed to
    /// a single space, lowercased (storage.ts:259-280).
    nonisolated static func favoriteTagKey(_ tag: String) -> String {
        tag.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").lowercased()
    }

    /// Mirrors `TagListStore.blacklisted` normalization: whitespace collapsed to `_`
    /// and lowercased (storage.ts:316-332).
    nonisolated static func blacklistTagKey(_ tag: String) -> String {
        tag.split(whereSeparator: { $0.isWhitespace }).joined(separator: "_").lowercased()
    }
}
