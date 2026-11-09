import SwiftUI

/// Explore tab: source switcher, source-aware quick filters, trending tags, a two-column
/// masonry grid, pull-to-refresh and infinite pagination.
///
/// Mirrors RN `FeedScreen` (src/screens/FeedScreen.tsx:332-577). The header is an
/// opaque overlay that slides away with the scroll (see `ScrollAwayHeaderView`) and is
/// pinned while refreshing or while the source sheet is open (FeedScreen.tsx:100-104).
@MainActor
struct FeedScreen: View {
    private let settings: AppSettings
    private let favoriteKeys: Set<String>
    private let onSelectTag: ((String) -> Void)?
    private let onOpenPost: ([BooruPost], Int) -> Void

    @State private var model: FeedViewModel
    @State private var isSourceSheetOpen = false
    /// Measured height of the overlaid header; the grid reserves exactly this much space.
    @State private var headerHeight: CGFloat = 132
    /// Vertical slide of the header; `-headerHeight` means fully scrolled away.
    @State private var headerSlide: CGFloat = 0

    private static let columnSpacing: CGFloat = 12
    private static let horizontalPadding: CGFloat = 12
    /// Named space the scroll-offset reader measures against.
    private static let scrollSpace = "feedScroll"

    /// - Parameters:
    ///   - settings: image quality, grid previews, and the starting source/order.
    ///   - context: transport and credentials handed to the source adapters.
    ///   - blacklistedTags: raw blacklist entries applied to every loaded page.
    ///   - favoriteKeys: `postKey` values that draw the favorite badge on a card.
    ///   - sourceProvider: source lookup, injectable for previews and tests.
    ///   - onSelectTag: trending-tag tap; the app layer pushes a search for the tag.
    ///   - onOpenPost: opens the viewer at `index` inside the loaded list
    ///     (RN `pushViewer(posts, idx)`, FeedScreen.tsx:325-330).
    init(
        settings: AppSettings,
        context: SourceContext,
        blacklistedTags: [String] = [],
        favoriteKeys: Set<String> = [],
        sourceProvider: @escaping FeedViewModel.SourceProvider = { SourceRegistry.source(for: $0) },
        onSelectTag: ((String) -> Void)? = nil,
        onOpenPost: @escaping ([BooruPost], Int) -> Void
    ) {
        self.settings = settings
        self.favoriteKeys = favoriteKeys
        self.onSelectTag = onSelectTag
        self.onOpenPost = onOpenPost
        _model = State(initialValue: FeedViewModel(
            sourceID: settings.activeSourceID,
            context: context,
            feedOrder: settings.feedOrder,
            blacklistedTags: blacklistedTags,
            sourceProvider: sourceProvider
        ))
    }

    /// Hosts that already built the model (stores, blacklist, source provider) pass it in,
    /// matching how `SearchScreen` receives its view model.
    init(
        viewModel: FeedViewModel,
        settings: AppSettings,
        favoriteKeys: Set<String> = [],
        onSelectTag: ((String) -> Void)? = nil,
        onOpenPost: @escaping ([BooruPost], Int) -> Void
    ) {
        self.settings = settings
        self.favoriteKeys = favoriteKeys
        self.onSelectTag = onSelectTag
        self.onOpenPost = onOpenPost
        _model = State(initialValue: viewModel)
    }

    // MARK: Body

    var body: some View {
        ZStack(alignment: .top) {
            AppTheme.background.ignoresSafeArea()

            feedContent

            ScrollAwayHeaderView(
                slideOffset: headerSlide,
                isPinned: isHeaderPinned
            ) {
                header
            }
        }
        .onPreferenceChange(ScrollAwayHeaderHeightKey.self) { height in
            if height > 0, abs(height - headerHeight) > 0.5 {
                headerHeight = height
            }
        }
        .sheet(isPresented: $isSourceSheetOpen) {
            SourceSheetView(selectedSource: model.sourceID) { id in
                isSourceSheetOpen = false
                Task { await model.selectSource(id) }
            }
            .presentationDetents([.medium, .large])
            .presentationBackground(AppTheme.background)
        }
        .task {
            await model.loadInitialIfNeeded()
        }
        .onChange(of: settings.activeSourceID) { _, newValue in
            guard newValue != model.sourceID else { return }
            Task { await model.selectSource(newValue) }
        }
    }

    /// RN keeps the header in place while refreshing, while the sheet is open, and when
    /// the screen loses focus (FeedScreen.tsx:100-104).
    private var isHeaderPinned: Bool {
        model.isRefreshing || isSourceSheetOpen
    }

    @ViewBuilder
    private var feedContent: some View {
        if model.posts.isEmpty {
            if case .failed(let message) = model.phase {
                errorState(message)
            } else if model.phase == .loading || model.phase == .idle {
                loadingState
            } else {
                emptyState
            }
        } else {
            grid
        }
    }

    // MARK: Grid

    private var grid: some View {
        ScrollView {
            VStack(spacing: Self.columnSpacing) {
                // Space for the overlaid header so the first row starts below it.
                Color.clear.frame(height: headerHeight)

                HStack(alignment: .top, spacing: Self.columnSpacing) {
                    column(leftColumn)
                    column(rightColumn)
                }

                footer
            }
            .padding(.horizontal, Self.horizontalPadding)
            .padding(.bottom, 24)
            .background {
                GeometryReader { proxy in
                    Color.clear.preference(
                        key: FeedScrollOffsetKey.self,
                        value: -proxy.frame(in: .named(Self.scrollSpace)).minY
                    )
                }
            }
        }
        .scrollIndicators(.hidden)
        .coordinateSpace(name: Self.scrollSpace)
        .onPreferenceChange(FeedScrollOffsetKey.self) { offset in
            let limit = max(headerHeight, 0)
            let slide = -min(max(offset, 0), limit)
            if abs(slide - headerSlide) > 0.5 {
                headerSlide = slide
            }
        }
        .refreshable {
            await model.refresh()
        }
    }

    /// Height-balanced masonry: each card goes to the currently shorter column.
    /// The weight is `1 / clampedAspectRatio` plus the uniform gap, which is the same
    /// greedy assignment RN runs in points (FeedScreen.tsx:270-294).
    private var columnSplit: (left: [BooruPost], right: [BooruPost]) {
        var left: [BooruPost] = []
        var right: [BooruPost] = []
        var leftWeight = 0.0
        var rightWeight = 0.0

        for post in model.posts {
            let weight = 1 / Self.clampedAspectRatio(post) + 0.07
            if leftWeight <= rightWeight {
                left.append(post)
                leftWeight += weight
            } else {
                right.append(post)
                rightWeight += weight
            }
        }
        return (left, right)
    }

    private var leftColumn: [BooruPost] { columnSplit.left }
    private var rightColumn: [BooruPost] { columnSplit.right }

    private func column(_ posts: [BooruPost]) -> some View {
        LazyVStack(spacing: Self.columnSpacing) {
            ForEach(posts) { post in
                card(for: post)
            }
            paginationSentinel
        }
        .frame(maxWidth: .infinity, alignment: .top)
    }

    private func card(for post: BooruPost) -> some View {
        PostCardView(
            post: post,
            imageQuality: settings.imageQuality,
            gridPreviewsEnabled: settings.gridPreviews,
            isFavorite: favoriteKeys.contains(postKey(post)),
            onTap: { open(post) }
        )
    }

    /// Lazy sentinel: it appears with the last row, which asks for the next page
    /// (FeedScreen.tsx:256-260, 504-506). Duplicate calls are guarded by the model.
    private var paginationSentinel: some View {
        Color.clear
            .frame(height: 1)
            .onAppear {
                Task { await model.loadMore() }
            }
    }

    @ViewBuilder
    private var footer: some View {
        if model.isLoadingMore {
            HStack(spacing: 8) {
                ProgressView()
                    .tint(AppTheme.primary)
                Text("Loading more...")
                    .font(.system(size: 13))
                    .foregroundStyle(AppTheme.textMuted)
            }
            .padding(.vertical, 20)
        } else if let message = model.errorMessage {
            Text(message)
                .font(.system(size: 12))
                .foregroundStyle(AppTheme.danger)
                .multilineTextAlignment(.center)
                .padding(.vertical, 16)
        }
    }

    private func open(_ post: BooruPost) {
        guard let target = model.openTarget(for: post) else { return }
        onOpenPost(target.posts, target.index)
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Explore")
                        .font(.system(size: 26, weight: .heavy))
                        .foregroundStyle(AppTheme.textPrimary)
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundStyle(AppTheme.textMuted)
                }

                Spacer(minLength: 8)

                sourcePill
            }
            .padding(.horizontal, 16)

            // A single Discover choice is not a filter (FeedScreen.tsx:369).
            if model.quickFilters.count > 1 {
                quickFilterBar
            }

            if !model.trendingTags.isEmpty {
                trendingBar
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 10)
    }

    /// RN subtitle (FeedScreen.tsx:344-346).
    private var subtitle: String {
        model.sourceID == .redgifs
            ? "Video clips and animations"
            : "Latest anime and illustrations"
    }

    private var sourceEntry: SourceSheetView.Entry {
        SourceSheetView.entry(for: model.sourceID)
    }

    private var sourcePill: some View {
        Button {
            isSourceSheetOpen = true
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "square.stack.3d.up.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(AppTheme.primaryLight)
                Text(sourceEntry.shortName)
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(AppTheme.surface, in: Capsule())
            .overlay {
                Capsule().stroke(AppTheme.border, lineWidth: 1)
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Current source: \(sourceEntry.name). Change source")
    }

    private var quickFilterBar: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(model.quickFilters) { option in
                    let selected = model.isActive(option)
                    Button {
                        Task { await model.applyQuickFilter(option) }
                    } label: {
                        Text(option.label)
                            .font(.system(size: 12, weight: selected ? .bold : .semibold))
                            .foregroundStyle(selected ? AppTheme.goldAccentText : AppTheme.textSecondary)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 7)
                            .background(selected ? AppTheme.goldAccent : AppTheme.chip, in: Capsule())
                            .overlay {
                                Capsule().stroke(
                                    selected ? AppTheme.goldAccent : AppTheme.chipBorder,
                                    lineWidth: 1
                                )
                            }
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(option.label)
                }
            }
            .padding(.horizontal, 16)
        }
        .scrollIndicators(.hidden)
    }

    /// RN rendered RedGifs trending tags here (FeedScreen.tsx:397-423); the cards are the
    /// same `TagChipView` chips, seeded from the loaded posts instead.
    private var trendingBar: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(AppTheme.goldAccent)
                Text("Trending Tags")
                    .font(.system(size: 11, weight: .bold))
                    .kerning(0.5)
                    .textCase(.uppercase)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            .padding(.horizontal, 16)

            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(model.trendingTags) { tag in
                        TagChipView(
                            text: tag.name,
                            category: tag.category,
                            count: tag.count,
                            onTap: tagTap(tag.name)
                        )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)
        }
    }

    private func tagTap(_ name: String) -> (() -> Void)? {
        guard let onSelectTag else { return nil }
        return { onSelectTag(name) }
    }

    // MARK: States

    private var loadingState: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(AppTheme.primary)
                .scaleEffect(1.4)
            Text("Loading posts...")
                .font(.system(size: 14))
                .foregroundStyle(AppTheme.textMuted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 40))
                .foregroundStyle(AppTheme.danger)
            Text("Connection Error")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(AppTheme.textPrimary)
            Text(friendlyMessage(message))
                .font(.system(size: 13))
                .foregroundStyle(AppTheme.textSecondary)
                .multilineTextAlignment(.center)

            HStack(spacing: 10) {
                Button {
                    Task { await model.retry() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 14, weight: .semibold))
                        Text("Retry")
                            .font(.system(size: 14, weight: .bold))
                    }
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(AppTheme.primary, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)

                Button {
                    isSourceSheetOpen = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "square.stack.3d.up.fill")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(AppTheme.primaryLight)
                        Text("Change Source")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(AppTheme.textPrimary)
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 12))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(AppTheme.border, lineWidth: 1)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Change source")
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "tray")
                .font(.system(size: 38))
                .foregroundStyle(AppTheme.textMuted)
            Text("No posts found")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(AppTheme.textPrimary)
            Text("Pull to refresh or try another source.")
                .font(.system(size: 13))
                .foregroundStyle(AppTheme.textSecondary)
                .multilineTextAlignment(.center)
            Button {
                Task { await model.retry() }
            } label: {
                Text("Retry")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(AppTheme.primary, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// RN rewrites certificate/timeout failures into an ISP/SSL hint
    /// (FeedScreen.tsx:436-440).
    private func friendlyMessage(_ raw: String) -> String {
        let lower = raw.lowercased()
        if lower.contains("certificate") || lower.contains("timed out") || lower.contains("ssl") {
            return "Could not reach the \(sourceEntry.name) source due to ISP or SSL blocking."
        }
        return raw
    }

    /// RN clamp (PostCard.tsx:84), reused for the column balance.
    private static func clampedAspectRatio(_ post: BooruPost) -> Double {
        let raw = post.aspectRatio > 0 ? post.aspectRatio : 0.75
        return min(1.4, max(0.6, raw))
    }
}

/// Scroll offset of the feed grid, measured from the top of the scroll content.
private struct FeedScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
