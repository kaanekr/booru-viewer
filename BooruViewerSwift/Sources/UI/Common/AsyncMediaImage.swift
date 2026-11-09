import SwiftUI
import UIKit

/// Async image with a static-cover fallback chain, loading through
/// `MediaImageLoader` so the request carries the media headers and the proxy
/// routing that `AsyncImage` cannot express.
///
/// RN keeps up to four cover attempts per card (PostCard.tsx:202-236): the primary
/// cover, the poster/thumbnail fallbacks, then a proxy leg. The proxy leg is now a
/// transport concern (`MediaImageLoader`), so this view walks the URL chain and
/// advances only when a load really fails, keeping the card fill underneath so a
/// loading card never flashes black.
struct AsyncMediaImage: View {
    private let urls: [URL]
    private let contentMode: ContentMode
    private let onImageLoaded: ((UIImage) -> Void)?

    /// Decoded image for the current chain; `nil` while loading or failed.
    @State private var image: UIImage?

    /// - Parameters:
    ///   - url: primary URL.
    ///   - fallbackURLs: tried in order after `url` fails.
    ///   - contentMode: `.fill` for covers, `.fit` for detail images.
    ///   - onImageLoaded: invoked whenever an image is resolved from cache or network.
    init(
        url: URL?,
        fallbackURLs: [URL] = [],
        contentMode: ContentMode = .fill,
        onImageLoaded: ((UIImage) -> Void)? = nil
    ) {
        var chain: [URL] = []
        for candidate in ([url].compactMap { $0 } + fallbackURLs) where !chain.contains(candidate) {
            chain.append(candidate)
        }
        urls = chain
        self.contentMode = contentMode
        self.onImageLoaded = onImageLoaded
    }

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: contentMode)
                    .transition(.opacity)
            } else {
                placeholder
            }
        }
        .task(id: urls) { await load() }
    }

    /// Same fill as the card body, so a loading card never flashes a light panel.
    private var placeholder: some View {
        AppTheme.card
    }

    /// Walks the chain until one URL decodes; a cached image is applied without
    /// a visible placeholder frame.
    private func load() async {
        guard !urls.isEmpty else {
            image = nil
            return
        }
        image = nil
        for url in urls {
            if Task.isCancelled { return }
            if let cached = await MediaImageLoader.shared.cachedImage(for: url) {
                if Task.isCancelled { return }
                image = cached
                onImageLoaded?(cached)
                return
            }
            do {
                let loaded = try await MediaImageLoader.shared.image(for: url)
                if Task.isCancelled { return }
                withAnimation(.easeIn(duration: 0.15)) {
                    image = loaded
                }
                onImageLoaded?(loaded)
                return
            } catch {
                // Real failure only: the loader already retried the other route leg.
                continue
            }
        }
        // Every candidate failed; the placeholder stays as the card fill.
        image = nil
    }
}
