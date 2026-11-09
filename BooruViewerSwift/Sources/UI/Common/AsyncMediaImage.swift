import SwiftUI

/// Async image with a static-cover fallback chain.
///
/// RN keeps up to four cover attempts per card (PostCard.tsx:202-236): the primary
/// cover, the poster/thumbnail fallbacks, then a proxy leg. The proxy is a native
/// transport concern, so this view only walks the URL chain the caller passes and
/// shows the card fill while a frame is missing or every URL failed.
struct AsyncMediaImage: View {
    private let urls: [URL]
    private let contentMode: ContentMode

    /// Index of the URL currently being attempted.
    @State private var index = 0

    /// - Parameters:
    ///   - url: primary URL.
    ///   - fallbackURLs: tried in order after `url` fails.
    ///   - contentMode: `.fill` for covers, `.fit` for detail images.
    init(url: URL?, fallbackURLs: [URL] = [], contentMode: ContentMode = .fill) {
        var chain: [URL] = []
        for candidate in ([url].compactMap { $0 } + fallbackURLs) where !chain.contains(candidate) {
            chain.append(candidate)
        }
        urls = chain
        self.contentMode = contentMode
    }

    var body: some View {
        ZStack {
            if let current = currentURL {
                AsyncImage(url: current, transaction: Transaction(animation: .easeIn(duration: 0.15))) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: contentMode)
                    case .failure:
                        // Advance only after the failure branch is on screen; mutating
                        // state while `body` runs is not allowed.
                        placeholder.onAppear(perform: advance)
                    case .empty:
                        placeholder
                    @unknown default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .onChange(of: urls) { _, _ in index = 0 }
    }

    private var currentURL: URL? {
        index >= 0 && index < urls.count ? urls[index] : nil
    }

    /// Same fill as the card body, so a loading card never flashes a light panel.
    private var placeholder: some View {
        AppTheme.card
    }

    /// Moves to the next fallback; stays on the last URL so the placeholder remains.
    private func advance() {
        guard index + 1 < urls.count else { return }
        index += 1
    }
}
