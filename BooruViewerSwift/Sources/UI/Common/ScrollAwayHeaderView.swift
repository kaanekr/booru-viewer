import SwiftUI

/// Height of the header content, reported so the grid can reserve exactly that much
/// space under the overlay (the RN header measures itself the same way,
/// src/utils/scrollAwayHeader.ts).
struct ScrollAwayHeaderHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = max(value, nextValue())
    }
}

/// Opaque Explore/Search header that slides up as the grid scrolls, mirroring RN
/// `ScrollAwayHeader` (src/components/ScrollAwayHeader.tsx).
///
/// The component is an overlay: it keeps its intrinsic height, paints the theme
/// background, and is translated by `slideOffset` so the cards scroll underneath it.
/// `isPinned` freezes it in place for refreshes, open sheets, and unfocused screens.
struct ScrollAwayHeaderView<Content: View>: View {
    /// Negative values move the controls (and their surface) up out of view.
    private let slideOffset: CGFloat
    /// When true the header ignores `slideOffset`.
    private let isPinned: Bool
    /// Height of the fixed opaque cover drawn above the controls (status bar area).
    private let topInset: CGFloat
    private let content: Content

    init(
        slideOffset: CGFloat = 0,
        isPinned: Bool = false,
        topInset: CGFloat = 0,
        @ViewBuilder content: () -> Content
    ) {
        self.slideOffset = slideOffset
        self.isPinned = isPinned
        self.topInset = topInset
        self.content = content()
    }

    var body: some View {
        content
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(AppTheme.background)
            .offset(y: isPinned ? 0 : slideOffset)
            .allowsHitTesting(isPinned || slideOffset > -1)
            .background(alignment: .top) {
                // RN keeps the safe-area strip opaque while the controls slide away
                // (ScrollAwayHeader.tsx:22-24). Drawn above the layout, so it changes no height.
                if topInset > 0 {
                    AppTheme.background
                        .frame(height: topInset)
                        .offset(y: -topInset)
                }
            }
            .background {
                GeometryReader { proxy in
                    Color.clear.preference(key: ScrollAwayHeaderHeightKey.self, value: proxy.size.height)
                }
            }
    }
}
