import SwiftUI

/// App shell: four tabs, the viewer cover, tag navigation, and the app-lock overlay.
///
/// The screens own their feature view models, but the container stays the single source for
/// settings, credentials, favorites, and blocked tags. Every tab change re-reads that shared
/// state so edits made in Settings (or by a backup import) reach Explore and Search.
@MainActor
struct RootTabView: View {
    enum Tab: Hashable {
        case explore
        case search
        case favorites
        case settings
    }

    /// The viewer needs its own identity: the same post list can be reopened.
    private struct ViewerPresentation: Identifiable {
        let id = UUID()
        let posts: [BooruPost]
        let index: Int
    }

    private let container: AppContainer

    @State private var selectedTab: Tab = .explore
    @State private var explorePath: [TagSearchTarget] = []
    @State private var viewer: ViewerPresentation?
    /// Search query requested from another tab (tag taps). Nil is the normal Search tab.
    @State private var pendingSearch: String?
    /// Bumped on every requested search so the Search screen is rebuilt with the new query.
    @State private var searchToken = 0
    @State private var settingsModel: SettingsViewModel

    init(container: AppContainer) {
        self.container = container
        _selectedTab = State(initialValue: Self.tab(for: container.launchOptions.initialTab))
        _settingsModel = State(initialValue: SettingsViewModel(
            settingsStore: container.settingsStore,
            blacklistedStore: container.blacklistedTagsStore,
            backupService: container.backupService,
            security: container.securityService,
            lockController: container.lockController,
            probeClient: { URLSessionHTTPClient.makeProbeClient() },
            clearSearchHistory: {
                if container.launchOptions.demoMode {
                    // Demo state lives in memory; never touch the storage file for it.
                    await container.clearDemoSearchHistory()
                    return
                }
                try await container.fileStore.write(SearchHistoryStore.fileName, [String]())
            },
            onSourceChanged: { _ in
                Task { @MainActor in
                    await container.reloadSharedState()
                }
            }
        ))
    }

    /// Maps `-initialTab` onto the tab selection; a normal launch keeps Explore.
    private static func tab(for initialTab: LaunchOptions.InitialTab?) -> Tab {
        switch initialTab {
        case .feed:
            return .explore
        case .search:
            return .search
        case .favorites:
            return .favorites
        case .settings:
            return .settings
        case nil:
            return .explore
        }
    }

    // MARK: - Body

    var body: some View {
        ZStack {
            TabView(selection: $selectedTab) {
                exploreTab
                    .tabItem { Label("Explore", systemImage: "square.grid.2x2.fill") }
                    .tag(Tab.explore)

                searchTab
                    .tabItem { Label("Search", systemImage: "magnifyingglass") }
                    .tag(Tab.search)

                favoritesTab
                    .tabItem { Label("Favorites", systemImage: "heart.fill") }
                    .tag(Tab.favorites)

                settingsTab
                    .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                    .tag(Tab.settings)
            }
            .tint(AppTheme.primary)

            // The lock/curtain covers the whole window, including the tab bar.
            // `-forceLock` skips the biometric auto-prompt so the PIN pad stays on screen.
            LockScreenView(
                controller: container.lockController,
                useBiometrics: !container.launchOptions.forceLock
            )
            .ignoresSafeArea()
            .allowsHitTesting(
                container.lockController.isLocked
                    || container.lockController.isPrivacyCurtainVisible
            )
        }
        .background(AppTheme.background.ignoresSafeArea())
        .fullScreenCover(item: $viewer, onDismiss: { reloadAfterViewer() }) { presentation in
            ViewerScreen(
                posts: presentation.posts,
                initialIndex: presentation.index,
                context: container.makeSourceContext(),
                recentViews: container.recentViewsStore,
                favorites: container.favoritesStore,
                favoriteTags: container.favoriteTagsStore,
                blacklistedTags: container.blacklistedTagsStore,
                onSelectTag: { tag in
                    viewer = nil
                    openTag(tag)
                },
                onClose: { viewer = nil }
            )
        }
        .onChange(of: selectedTab) { _, tab in
            Task { @MainActor in
                await container.reloadSharedState()
                if tab == .settings {
                    await settingsModel.load(force: true)
                }
            }
        }
    }

    // MARK: - Tabs

    private var exploreTab: some View {
        NavigationStack(path: $explorePath) {
            FeedScreen(
                settings: container.settings,
                context: container.makeSourceContext(),
                blacklistedTags: container.blacklistedTags,
                favoriteKeys: container.favoriteKeys,
                sourceProvider: container.sourceProvider,
                onSelectTag: { tag in
                    explorePath.append(
                        TagSearchTarget(sourceID: container.settings.activeSourceID, tags: tag)
                    )
                },
                onOpenPost: { posts, index in openViewer(posts, index) }
            )
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: TagSearchTarget.self) { target in
                detailScreen(for: target)
            }
        }
    }

    private var searchTab: some View {
        NavigationStack {
            SearchScreen(
                activeSourceID: container.settings.activeSourceID,
                context: container.makeSourceContext(),
                historyStore: container.searchHistoryStore,
                blacklistedTags: container.blacklistedTags,
                favoriteKeys: container.favoriteKeys,
                imageQuality: container.settings.imageQuality,
                gridPreviewsEnabled: container.settings.gridPreviews,
                sourceProvider: container.sourceProvider,
                initialQuery: pendingSearch,
                onOpenTag: { tag in openTag(tag) },
                onToggleFavorite: { post in
                    Task { @MainActor in await container.toggleFavorite(post) }
                },
                onOpenPost: { posts, index in openViewer(posts, index) }
            )
            .toolbar(.hidden, for: .navigationBar)
            .id(searchToken)
        }
    }

    private var favoritesTab: some View {
        NavigationStack {
            FavoritesScreen(
                favoritesStore: container.favoritesStore,
                tagStore: container.favoriteTagsStore,
                recentViewsStore: container.recentViewsStore,
                clearRecentViews: { await container.clearRecentViews() },
                isActive: selectedTab == .favorites,
                imageQuality: container.settings.imageQuality,
                gridPreviewsEnabled: container.settings.gridPreviews,
                onSelectTag: { tag in openTag(tag) },
                onOpenPost: { posts, index in openViewer(posts, index) }
            )
        }
    }

    private var settingsTab: some View {
        NavigationStack {
            SettingsScreen(viewModel: settingsModel)
        }
    }

    // MARK: - Navigation

    private func detailScreen(for target: TagSearchTarget) -> some View {
        SearchDetailScreen(
            sourceID: target.sourceID,
            tags: target.tags,
            context: container.makeSourceContext(),
            historyStore: container.searchHistoryStore,
            blacklistedTags: container.blacklistedTags,
            imageQuality: container.settings.imageQuality,
            gridPreviewsEnabled: container.settings.gridPreviews,
            sourceProvider: container.sourceProvider,
            onOpenPost: { posts, index in openViewer(posts, index) }
        )
    }

    private func openViewer(_ posts: [BooruPost], _ index: Int) {
        viewer = ViewerPresentation(posts: posts, index: index)
    }

    /// Tag taps outside Explore switch to the Search tab with a fresh query.
    private func openTag(_ tag: String) {
        pendingSearch = tag
        searchToken += 1
        selectedTab = .search
    }

    private func reloadAfterViewer() {
        Task { @MainActor in await container.reloadFavorites() }
    }
}
