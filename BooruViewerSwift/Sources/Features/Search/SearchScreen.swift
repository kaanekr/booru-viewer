import SwiftUI

/// Search tab: tag input with debounced server autocomplete, recent-search chips, the filter sheet,
/// and a two-column result grid. Mirrors RN `SearchScreen.tsx`.
///
/// The screen owns its `SearchViewModel`; `activeSourceID` is observed so a source change from the
/// app layer resets the search, exactly like `FeedScreen`.
@MainActor
struct SearchScreen: View {
    private let activeSourceID: SourceID
    private let favoriteKeys: Set<String>
    private let imageQuality: ImageQuality
    private let gridPreviewsEnabled: Bool
    private let onOpenTag: ((String) -> Void)?
    private let onToggleFavorite: ((BooruPost) -> Void)?
    private let onOpenPost: ([BooruPost], Int) -> Void

    @State private var model: SearchViewModel
    @State private var isFilterSheetPresented = false
    @State private var isSourceSheetPresented = false
    @FocusState private var isSearchFieldFocused: Bool

    /// RN `POPULAR_TAGS` (SearchScreen.tsx:66-77) plus a wider set of community favourites,
    /// so the popular section fills the viewport instead of leaving the lower half empty.
    private static let popularTags = [
        "original", "1girl", "hatsune_miku", "scenery", "genshin_impact",
        "arknights", "hololive", "frieren", "blue_archive", "cyberpunk",
        "solo", "1boy", "long_hair", "landscape", "cityscape", "chibi",
        "monochrome", "kemonomimi", "cosplay", "cherry_blossoms",
        "night_sky", "aesthetic", "portrait", "wallpaper"
    ]

    private static let gridColumns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    /// - Parameters:
    ///   - activeSourceID: source the search opens on (RN default `gelbooru`).
    ///   - context: transport and credentials handed to the source adapters.
    ///   - historyStore: persisted search history.
    ///   - blacklistedTags: raw blacklist entries applied to every loaded page.
    ///   - favoriteKeys: `postKey` values that draw the favorite badge on a card.
    ///   - initialQuery: search to run on appear (pushed detail searches).
    ///   - initialFilter: filter-sheet style initial search; wins over `initialQuery`.
    ///   - onOpenTag: active-tag chip tap; a pushed search uses it for chained navigation.
    ///   - onToggleFavorite: long-press action for a card.
    ///   - onOpenPost: opens the viewer at `index` inside the result list.
    init(
        activeSourceID: SourceID,
        context: SourceContext,
        historyStore: any SearchHistoryStoring,
        blacklistedTags: [String] = [],
        favoriteKeys: Set<String> = [],
        imageQuality: ImageQuality = .auto,
        gridPreviewsEnabled: Bool = true,
        sourceProvider: @escaping SearchViewModel.SourceProvider = { SourceRegistry.source(for: $0) },
        initialQuery: String? = nil,
        initialFilter: SearchFilterConfig? = nil,
        onOpenTag: ((String) -> Void)? = nil,
        onToggleFavorite: ((BooruPost) -> Void)? = nil,
        onOpenPost: @escaping ([BooruPost], Int) -> Void = { _, _ in }
    ) {
        self.activeSourceID = activeSourceID
        self.favoriteKeys = favoriteKeys
        self.imageQuality = imageQuality
        self.gridPreviewsEnabled = gridPreviewsEnabled
        self.onOpenTag = onOpenTag
        self.onToggleFavorite = onToggleFavorite
        self.onOpenPost = onOpenPost
        _model = State(initialValue: SearchViewModel(
            sourceID: activeSourceID,
            context: context,
            historyStore: historyStore,
            blacklistedTags: blacklistedTags,
            sourceProvider: sourceProvider,
            initialQuery: initialQuery,
            initialFilter: initialFilter
        ))
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            if isSearchFieldFocused, !model.suggestions.isEmpty {
                suggestionList
            } else if model.isSearchActive {
                resultsContent
            } else {
                exploreContent
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
        .task { await model.start() }
        .onChange(of: isSearchFieldFocused) { _, focused in
            model.inputFocusChanged(focused)
        }
        .onChange(of: activeSourceID) { _, newValue in
            model.selectSource(newValue)
        }
        .sheet(isPresented: $isFilterSheetPresented) {
            SearchFilterSheetView(config: filterBinding, sourceID: model.sourceID) { config in
                model.applyFilter(config)
            }
        }
        .sheet(isPresented: $isSourceSheetPresented) {
            SourceSheetView(selectedSource: model.sourceID) { id in
                isSourceSheetPresented = false
                model.selectSource(id)
            }
            .presentationDetents([.medium, .large])
            .presentationBackground(AppTheme.background)
        }
    }

    private var filterBinding: Binding<SearchFilterConfig> {
        Binding(
            get: { model.filter },
            set: { model.filter = $0 }
        )
    }

    // MARK: Header

    private var header: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                sourcePill
                searchField
                filterButton
            }
            if onOpenTag != nil, !model.filter.tags.isEmpty {
                activeTagChips
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 10)
        .background(AppTheme.background)
    }

    private var sourceEntry: SourceSheetView.Entry {
        SourceSheetView.entry(for: model.sourceID)
    }

    private var sourcePill: some View {
        Button {
            isSearchFieldFocused = false
            isSourceSheetPresented = true
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

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(AppTheme.textMuted)

            TextField("Search tags or creators...", text: queryBinding)
                .focused($isSearchFieldFocused)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .font(.system(size: 14))
                .foregroundStyle(AppTheme.textPrimary)
                .onSubmit {
                    isSearchFieldFocused = false
                    model.runSearch()
                }

            if !model.query.isEmpty {
                Button {
                    model.setQuery("")
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(AppTheme.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search text")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(AppTheme.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(isSearchFieldFocused ? AppTheme.primary : AppTheme.border, lineWidth: 1)
        }
    }

    private var queryBinding: Binding<String> {
        Binding(
            get: { model.query },
            set: { model.setQuery($0) }
        )
    }

    private var filterButton: some View {
        Button {
            isSearchFieldFocused = false
            isFilterSheetPresented = true
        } label: {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(model.hasCustomFilters ? AppTheme.primaryLight : AppTheme.textSecondary)
                .frame(width: 38, height: 38)
                .background(AppTheme.surface, in: RoundedRectangle(cornerRadius: 12))
                .overlay {
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(model.hasCustomFilters ? AppTheme.primary : AppTheme.border, lineWidth: 1)
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Search filters")
    }

    private var activeTagChips: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(model.filter.tags, id: \.self) { tag in
                    TagChipView(text: tag, isSelected: true, onTap: { onOpenTag?(tag) })
                }
            }
        }
        .scrollIndicators(.hidden)
    }

    // MARK: Autocomplete

    private var suggestionList: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(model.suggestions, id: \.name) { suggestion in
                    Button {
                        isSearchFieldFocused = false
                        model.applySuggestion(suggestion, immediateSearch: true)
                    } label: {
                        HStack(spacing: 10) {
                            Circle()
                                .fill(AppTheme.tagColor(for: suggestion.category))
                                .frame(width: 8, height: 8)
                            Text(suggestion.name)
                                .font(.system(size: 14, weight: .semibold))
                                .lineLimit(1)
                                .foregroundStyle(AppTheme.textPrimary)
                            Spacer(minLength: 8)
                            Text(TagChipView.abbreviated(suggestion.postCount))
                                .font(.system(size: 11))
                                .foregroundStyle(AppTheme.textMuted)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    Divider().overlay(AppTheme.divider)
                }
            }
        }
        .scrollDismissesKeyboard(.immediately)
    }

    // MARK: Results

    private var resultsContent: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                if model.isLoading {
                    loadingState
                } else if let message = model.errorMessage {
                    errorState(message)
                } else {
                    if !model.results.isEmpty {
                        grid
                    }
                    if model.isLoadingMore {
                        ProgressView()
                            .tint(AppTheme.primary)
                            .padding(.vertical, 14)
                    } else if model.blacklistedCount > 0, !model.filter.includeBlacklisted {
                        hiddenPostsButton
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
    }

    private var grid: some View {
        LazyVGrid(columns: Self.gridColumns, spacing: 12) {
            ForEach(model.results.indices, id: \.self) { index in
                let post = model.results[index]
                let longPress: (() -> Void)? = onToggleFavorite.map { handler in { handler(post) } }
                PostCardView(
                    post: post,
                    imageQuality: imageQuality,
                    gridPreviewsEnabled: gridPreviewsEnabled,
                    isFavorite: favoriteKeys.contains(postKey(post)),
                    onTap: { open(post) },
                    onLongPress: longPress
                )
                .onAppear {
                    // Prefetch the next page when the last card appears (RN `onEndReached`).
                    if index == model.results.count - 1 {
                        model.loadMore()
                    }
                }
            }
        }
    }

    private var hiddenPostsButton: some View {
        Button {
            model.showBlacklistedPosts()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "eye.slash")
                Text("Show \(model.blacklistedCount) hidden posts")
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(AppTheme.textSecondary)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 11)
            .background(AppTheme.card, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    private var loadingState: some View {
        VStack(spacing: 10) {
            ProgressView()
                .tint(AppTheme.primary)
                .scaleEffect(1.2)
            Text("Searching results...")
                .font(.system(size: 13))
                .foregroundStyle(AppTheme.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 60)
    }

    private func errorState(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 36))
                .foregroundStyle(AppTheme.danger)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(AppTheme.textSecondary)
                .multilineTextAlignment(.center)
            Button {
                model.runSearch()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 13, weight: .semibold))
                    Text("Retry")
                        .font(.system(size: 14, weight: .bold))
                }
                .foregroundStyle(Color.white)
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(AppTheme.primary, in: RoundedRectangle(cornerRadius: 12))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity)
        .padding(.top, 48)
    }

    private func open(_ post: BooruPost) {
        guard let target = model.openTarget(for: post) else { return }
        onOpenPost(target.posts, target.index)
    }

    // MARK: Explore

    private var exploreContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if !model.history.isEmpty {
                    recentSearches
                }
                popularTagsSection
            }
            .padding(16)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
    }

    private var recentSearches: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 11))
                    .foregroundStyle(AppTheme.textSecondary)
                Text("Recent Searches")
                    .font(.system(size: 11, weight: .bold))
                    .kerning(0.5)
                    .textCase(.uppercase)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            ScrollView(.horizontal) {
                HStack(spacing: 6) {
                    ForEach(model.history, id: \.self) { entry in
                        TagChipView(text: entry, onTap: {
                            isSearchFieldFocused = false
                            model.search(text: entry)
                        })
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)
        }
    }

    private var popularTagsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "flame.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(AppTheme.goldAccent)
                Text("Popular Tags")
                    .font(.system(size: 11, weight: .bold))
                    .kerning(0.5)
                    .textCase(.uppercase)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            PopularTagFlowLayout(spacing: 8, lineSpacing: 8) {
                ForEach(Self.popularTags, id: \.self) { tag in
                    TagChipView(text: tag, onTap: {
                        isSearchFieldFocused = false
                        model.search(text: tag)
                    })
                }
            }
        }
    }
}

// MARK: - Popular tag flow

/// Left-aligned wrapping row of chips.
///
/// A `LazyVGrid` with `.adaptive` columns stretches every cell to the same width, which left
/// wide irregular gaps between short tags; this layout lets each chip keep its intrinsic size
/// and wraps to the next line only when the width is exhausted (same behaviour as
/// `TagFlowLayout` in `PostInfoSheetView`).
private struct PopularTagFlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0
        var contentWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            contentWidth = max(contentWidth, x + size.width)
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }

        return CGSize(
            width: maxWidth.isFinite ? maxWidth : contentWidth,
            height: y + lineHeight
        )
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {
        var x = bounds.minX
        var y = bounds.minY
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
