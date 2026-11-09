import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// What a trending-tag context-menu action should do with the Search tab query.
///
/// Mirrors the viewer's tag menu (`TagSearchModification`): a plain tag search,
/// `+tag` appended to the current query, or `-tag` appended to it.
enum FeedTagSearchAction: Sendable {
    /// Replace the query with the tag.
    case replace
    /// Append `+tag` to the current query.
    case include
    /// Append `-tag` to the current query.
    case exclude
}

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
    /// Request context handed to the model at build time and re-pushed on `contextVersion` changes.
    private let context: SourceContext
    /// Bumped by the app layer whenever the request context (Worker, keys, quality) changes.
    private let contextVersion: Int
    /// Persists a source picked in the sheet so every tab follows the switch.
    private let onSelectSource: ((SourceID) -> Void)?
    /// Long-press action: pin a trending tag to the favorite-tag list.
    private let onPinTag: ((String) -> Void)?
    /// Long-press action: add a trending tag to the blacklist.
    private let onBlacklistTag: ((String) -> Void)?
    /// Long-press action: rewrite the Search tab query with a trending tag.
    private let onSearchAction: ((String, FeedTagSearchAction) -> Void)?

    @State private var model: FeedViewModel
    @State private var isSourceSheetOpen = false
    /// Measured height of the overlaid header; the grid reserves exactly this much space.
    @State private var headerHeight: CGFloat = 132
    /// Vertical slide of the header; `-headerHeight` means fully scrolled away.
    @State private var headerSlide: CGFloat = 0
    /// Directional show/hide accumulator for the header (RN `advanceScrollHeader`).
    @State private var headerState = ScrollAwayHeaderState()
    /// Memoized masonry split: rebuilt only when the page or the column width changes,
    /// never on plain body evaluation.
    @State private var columns: [[BooruPost]] = [[], []]
    /// Bumped by a header tap; the grid observes it and scrolls back to the top.
    @State private var scrollToTopSignal = 0

    private static let columnSpacing: CGFloat = 12
    private static let horizontalPadding: CGFloat = 12
    /// Bottom breathing room inside the scroll content; the tab-bar clearance is
    /// handled by the host, not here.
    private static let bottomPadding: CGFloat = 12
    /// Named space the scroll-offset reader measures against.
    private static let scrollSpace = "feedScroll"
    /// Anchor for "tap the header to jump to the top" (FeedScreen.tsx:340).
    private static let topAnchor = "feedTopAnchor"
    /// RN slide duration for the header (scrollAwayHeader.ts:66).
    private static let headerAnimationDuration: Double = 0.18
    /// Duration of the header-tap scroll back to the top.
    private static let scrollToTopDuration: Double = 0.25

    /// - Parameters:
    ///   - settings: image quality, grid previews, and the starting source/order.
    ///   - context: transport and credentials handed to the source adapters.
    ///   - blacklistedTags: raw blacklist entries applied to every loaded page.
    ///   - favoriteKeys: `postKey` values that draw the favorite badge on a card.
    ///   - sourceProvider: source lookup, injectable for previews and tests.
    ///   - onSelectTag: trending-tag tap; the app layer pushes a search for the tag.
    ///   - onOpenPost: opens the viewer at `index` inside the loaded list
    ///     (RN `pushViewer(posts, idx)`, FeedScreen.tsx:325-330).
    ///   - contextVersion: app-level change counter for the request context; a new value pushes
    ///     the fresh `context` into the view model without rebuilding the screen.
    ///   - onSelectSource: persists a source switch made in the sheet (FeedScreen.tsx:215-226).
    ///   - onPinTag: trending-chip long press; adds the tag to the favorite tags.
    ///   - onBlacklistTag: trending-chip long press; adds the tag to the blacklist.
    ///   - onSearchAction: trending-chip long press; opens the Search tab with the tag.
    init(
        settings: AppSettings,
        context: SourceContext,
        blacklistedTags: [String] = [],
        favoriteKeys: Set<String> = [],
        contextVersion: Int = 0,
        sourceProvider: @escaping FeedViewModel.SourceProvider = { SourceRegistry.source(for: $0) },
        onSelectTag: ((String) -> Void)? = nil,
        onSelectSource: ((SourceID) -> Void)? = nil,
        onPinTag: ((String) -> Void)? = nil,
        onBlacklistTag: ((String) -> Void)? = nil,
        onSearchAction: ((String, FeedTagSearchAction) -> Void)? = nil,
        onOpenPost: @escaping ([BooruPost], Int) -> Void
    ) {
        self.settings = settings
        self.favoriteKeys = favoriteKeys
        self.onSelectTag = onSelectTag
        self.onOpenPost = onOpenPost
        self.context = context
        self.contextVersion = contextVersion
        self.onSelectSource = onSelectSource
        self.onPinTag = onPinTag
        self.onBlacklistTag = onBlacklistTag
        self.onSearchAction = onSearchAction
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
        contextVersion: Int = 0,
        onSelectTag: ((String) -> Void)? = nil,
        onSelectSource: ((SourceID) -> Void)? = nil,
        onPinTag: ((String) -> Void)? = nil,
        onBlacklistTag: ((String) -> Void)? = nil,
        onSearchAction: ((String, FeedTagSearchAction) -> Void)? = nil,
        onOpenPost: @escaping ([BooruPost], Int) -> Void
    ) {
        self.settings = settings
        self.favoriteKeys = favoriteKeys
        self.onSelectTag = onSelectTag
        self.onOpenPost = onOpenPost
        self.context = viewModel.context
        self.contextVersion = contextVersion
        self.onSelectSource = onSelectSource
        self.onPinTag = onPinTag
        self.onBlacklistTag = onBlacklistTag
        self.onSearchAction = onSearchAction
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
        .onChange(of: headerHeight) { _, _ in
            resetHeaderSlide()
        }
        .onChange(of: isHeaderPinned) { _, _ in
            resetHeaderSlide()
        }
        .sheet(isPresented: $isSourceSheetOpen) {
            SourceSheetView(selectedSource: model.sourceID) { id in
                isSourceSheetOpen = false
                // Persist the pick so Explore, Search, and Settings stay in sync.
                onSelectSource?(id)
                Task { await model.selectSource(id) }
            }
            .presentationDetents([.medium, .large])
            .presentationBackground(AppTheme.background)
        }
        .task {
            await model.loadInitialIfNeeded()
        }
        .onAppear {
            model.updateContext(context)
        }
        .onChange(of: contextVersion) { _, _ in
            // A Worker URL, API key, or quality edit pushes a fresh context into the model.
            model.updateContext(context)
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
        GeometryReader { geometry in
            let width = geometry.size.width
            let columnWidth = Self.columnWidth(for: width)

            ScrollViewReader { scrollProxy in
                ScrollView {
                    VStack(spacing: Self.columnSpacing) {
                        // Space for the overlaid header so the first row starts below it.
                        // Also the anchor the header tap scrolls back to.
                        Color.clear
                            .frame(height: headerHeight)
                            .id(Self.topAnchor)

                        HStack(alignment: .top, spacing: Self.columnSpacing) {
                            ForEach(columns.indices, id: \.self) { index in
                                column(columns[index], width: columnWidth)
                            }
                        }

                        footer
                    }
                    .padding(.horizontal, Self.horizontalPadding)
                    .padding(.bottom, Self.bottomPadding)
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
                .onAppear {
                    rebuildColumns(width: width)
                }
                .onChange(of: width) { _, newWidth in
                    rebuildColumns(width: newWidth)
                }
                .onChange(of: model.posts) { _, _ in
                    rebuildColumns(width: width)
                }
                .onChange(of: scrollToTopSignal) { _, _ in
                    withAnimation(.easeOut(duration: Self.scrollToTopDuration)) {
                        scrollProxy.scrollTo(Self.topAnchor, anchor: .top)
                    }
                }
                .onPreferenceChange(FeedScrollOffsetKey.self) { offset in
                    updateHeader(for: offset)
                }
                .refreshable {
                    await model.refresh()
                }
            }
        }
    }

    /// Memoized masonry split. Recomputed only when a page lands, the column width
    /// changes, or the grid first appears — never on plain body evaluation.
    private func rebuildColumns(width: CGFloat) {
        let posts = model.posts
        guard !posts.isEmpty else {
            if !columns.allSatisfy(\.isEmpty) {
                columns = [[], []]
            }
            return
        }

        let columnWidth = Self.columnWidth(for: width)
        var masonry = MasonryColumns()
        let next = masonry.layout(posts) { post in
            MasonryColumns.estimatedHeight(for: post, columnWidth: columnWidth)
        }
        if next != columns {
            columns = next
        }
    }

    /// Equal column width that fits the measured grid exactly; the sub-point
    /// remainder is dropped rather than letterboxing the cards.
    private static func columnWidth(for totalWidth: CGFloat) -> CGFloat {
        let usable = totalWidth - Self.horizontalPadding * 2 - Self.columnSpacing
        guard usable > 0 else { return 0 }
        return (usable / CGFloat(MasonryColumns.defaultColumnCount)).rounded(.down)
    }

    private func column(_ posts: [BooruPost], width: CGFloat) -> some View {
        LazyVStack(spacing: Self.columnSpacing) {
            ForEach(posts) { post in
                card(for: post)
            }
            // Skip the sentinel while the memoized split is still empty, so an
            // unbuilt column cannot request page 2 before the cards exist.
            if !posts.isEmpty {
                paginationSentinel
            }
        }
        .frame(width: width > 0 ? width : nil, alignment: .top)
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

    /// Directional header reveal/hide. RN hides it once the grid has moved down
    /// 12pt and reveals it again after 12pt back up, no matter the absolute offset
    /// (src/utils/scrollAwayHeader.ts:14-27).
    private func updateHeader(for offset: CGFloat) {
        guard !isHeaderPinned else {
            resetHeaderSlide()
            return
        }
        let hidden = headerState.advance(to: offset, height: headerHeight)
        setHeaderSlide(hidden ? -max(headerHeight, 0) : 0)
    }

    private func setHeaderSlide(_ slide: CGFloat) {
        guard abs(slide - headerSlide) > 0.5 else { return }
        withAnimation(.easeOut(duration: Self.headerAnimationDuration)) {
            headerSlide = slide
        }
    }

    /// Pinned refreshes, header remeasurement, and the source sheet put it back.
    private func resetHeaderSlide() {
        headerState.reset()
        setHeaderSlide(0)
    }

    /// RN scrolls the grid to y: 0 when the "Explore" title is tapped
    /// (src/screens/FeedScreen.tsx:338-346).
    private func scrollGridToTop() {
        scrollToTopSignal &+= 1
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 12) {
                Button(action: scrollGridToTop) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Explore")
                            .font(.system(size: 26, weight: .heavy))
                            .foregroundStyle(AppTheme.textPrimary)
                        Text(subtitle)
                            .font(.system(size: 12))
                            .foregroundStyle(AppTheme.textMuted)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Explore. Scroll to top")

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
                        .contextMenu {
                            trendingTagMenu(tag.name)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)
        }
    }

    /// Long press on a trending chip: search, include/exclude, pin, blacklist, or copy it.
    @ViewBuilder
    private func trendingTagMenu(_ name: String) -> some View {
        Button {
            runSearchAction(name, .replace)
        } label: {
            Label("Search Tag", systemImage: "magnifyingglass")
        }
        Button {
            runSearchAction(name, .include)
        } label: {
            Label("Add to Search (+\(name))", systemImage: "plus.magnifyingglass")
        }
        Button {
            runSearchAction(name, .exclude)
        } label: {
            Label("Exclude from Search (-\(name))", systemImage: "minus.magnifyingglass")
        }
        Button {
            onPinTag?(name)
        } label: {
            Label("Pin to Favorite Tags", systemImage: "pin")
        }
        Button(role: .destructive) {
            onBlacklistTag?(name)
        } label: {
            Label("Add to Blacklist", systemImage: "eye.slash")
        }
        Button {
            copyTag(name)
        } label: {
            Label("Copy Tag", systemImage: "doc.on.doc")
        }
    }

    /// `.replace` falls back to the existing tap handler when no Search-tab hook is wired.
    private func runSearchAction(_ name: String, _ action: FeedTagSearchAction) {
        if let onSearchAction {
            onSearchAction(name, action)
        } else if action == .replace {
            onSelectTag?(name)
        }
    }

    private func copyTag(_ name: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = name
        #endif
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
}

/// Scroll offset of the feed grid, measured from the top of the scroll content.
private struct FeedScrollOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

/// Directional show/hide accumulator for the Explore header, mirroring RN
/// `advanceScrollHeader` (src/utils/scrollAwayHeader.ts:14-27).
///
/// Rubber-band movement is ignored, the header cannot hide until the grid has
/// scrolled past it, and a deliberate 12pt move in one direction flips the state.
/// The per-event travel is clamped so a fast fling still needs a real reversal.
private struct ScrollAwayHeaderState {
    /// Previous clamped offset; nil until the first scroll event.
    private var offset: CGFloat?
    /// Accumulated movement in the current direction, clamped to ±12.
    private var travel: CGFloat = 0
    private(set) var hidden = false

    mutating func advance(to rawOffset: CGFloat, height: CGFloat) -> Bool {
        guard height > 0 else { return hidden }
        let offset = max(rawOffset, 0)
        if offset <= 0 {
            reset()
            return hidden
        }
        guard let previous = self.offset else {
            self.offset = offset
            return hidden
        }

        let delta = offset - previous
        if delta != 0 {
            travel = delta.sign == travel.sign ? travel + delta : delta
        }
        if offset < height || travel <= -12 {
            hidden = false
        } else if travel >= 12 {
            hidden = true
        }
        travel = min(12, max(-12, travel))
        self.offset = offset
        return hidden
    }

    mutating func reset() {
        offset = nil
        travel = 0
        hidden = false
    }
}
