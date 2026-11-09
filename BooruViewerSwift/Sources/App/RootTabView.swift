import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// App shell: four tabs, the viewer cover, tag navigation, and the app-lock overlay.
///
/// The screens own their feature view models, but the container stays the single source for
/// settings, credentials, favorites, and blocked tags. Every tab change re-reads that shared
/// state so edits made in Settings (or by a backup import) reach Explore and Search.
@MainActor
struct RootTabView: View {
    enum Tab: String, Hashable, CaseIterable {
        case explore
        case search
        case favorites
        case settings

        /// Label under the icon in the system tab bar.
        var title: String {
            switch self {
            case .explore: return "Explore"
            case .search: return "Search"
            case .favorites: return "Favorites"
            case .settings: return "Settings"
            }
        }

        /// SF Symbol for the system tab bar item.
        var symbol: String {
            switch self {
            case .explore: return "square.grid.2x2.fill"
            case .search: return "magnifyingglass"
            case .favorites: return "heart.fill"
            case .settings: return "gearshape.fill"
            }
        }
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
            // Native `UITabBar` (restored). The bar's colours come from `UITabBarAppearance`
            // in `BooruViewerApp`, the per-tab `.toolbarBackground` below, and the container
            // theming in `themeContainers()`. Those layers are what keep the bar, its reserved
            // container, and the home-indicator floor on `AppTheme.background` (#0B0D13)
            // instead of a pure-black band.
            TabView(selection: $selectedTab) {
                exploreTab
                    .tabItem { Label(Tab.explore.title, systemImage: Tab.explore.symbol) }
                    .tag(Tab.explore)

                searchTab
                    .tabItem { Label(Tab.search.title, systemImage: Tab.search.symbol) }
                    .tag(Tab.search)

                favoritesTab
                    .tabItem { Label(Tab.favorites.title, systemImage: Tab.favorites.symbol) }
                    .tag(Tab.favorites)

                settingsTab
                    .tabItem { Label(Tab.settings.title, systemImage: Tab.settings.symbol) }
                    .tag(Tab.settings)
            }
            .tint(AppTheme.primary)

            // The lock/curtain covers the whole window, including the tab bar.
            // `-forceLock` skips the biometric auto-prompt so the PIN pad stays on screen.
            // No `.ignoresSafeArea()` here: the pad keeps its top inset so the padlock badge
            // clears the Dynamic Island, and `LockScreenView` bleeds its opaque layers itself.
            LockScreenView(
                controller: container.lockController,
                useBiometrics: !container.launchOptions.forceLock
            )
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
            // Fires only on an actual tab change (not on first appearance). A tab switch may
            // rebuild the tab controller's container, so re-run the theming pass.
            Self.playTabSelectionHaptic()
            Self.scheduleContainerTheming()
            Task { @MainActor in
                await container.reloadSharedState()
                if tab == .settings {
                    await settingsModel.load(force: true)
                }
            }
        }
        .onAppear {
            // SwiftUI's `.background` stops at the hosting view; every UIKit container between
            // the content and the window is themed explicitly.
            Self.scheduleContainerTheming()
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
        .background(AppTheme.background.ignoresSafeArea())
        .toolbarBackground(AppTheme.background, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
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
        .background(AppTheme.background.ignoresSafeArea())
        .toolbarBackground(AppTheme.background, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
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
        .background(AppTheme.background.ignoresSafeArea())
        .toolbarBackground(AppTheme.background, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }

    private var settingsTab: some View {
        NavigationStack {
            SettingsScreen(viewModel: settingsModel)
        }
        .background(AppTheme.background.ignoresSafeArea())
        .toolbarBackground(AppTheme.background, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }

    // MARK: - Haptics

    /// Light tap feedback on every tab change, mirroring RN's `Haptics.impactAsync(.Light)`.
    private static func playTabSelectionHaptic() {
        #if canImport(UIKit)
        let generator = UISelectionFeedbackGenerator()
        generator.prepare()
        generator.selectionChanged()
        #endif
    }

    // MARK: - Window theming

    /// Themes every UIKit surface that composites over the window with `AppTheme.background`.
    ///
    /// SwiftUI's `.background` stops at the hosting view. The system tab bar's container reserves
    /// a larger area than the bar itself paints (iOS 26 floating bar), and that container - like
    /// each navigation container - sits directly on the `UIWindow`, which defaults to pure black.
    /// Painting the window and every container view #0B0D13 means a transparent system surface can
    /// only blend towards the theme colour, so no #000000 band can remain.
    ///
    /// Idempotent: it only reassigns colours, so it is safe to run on first layout, after the
    /// 0.35 s rebuild, and again on every appearance.
    @MainActor
    static func themeContainers() {
        #if canImport(UIKit)
        let color = UIColor(AppTheme.background)
        for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
            for window in scene.windows {
                window.backgroundColor = color
                guard let root = window.rootViewController else { continue }
                var visited: Set<ObjectIdentifier> = []
                theme(controller: root, color: color, visited: &visited)
            }
        }
        #endif
    }

    /// Runs the container pass on the next main-queue turn and again after the first layout.
    private static func scheduleContainerTheming() {
        DispatchQueue.main.async {
            Self.themeContainers()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
            Self.themeContainers()
        }
    }

    /// Depth-first walk of one controller tree, theming the container each node owns.
    ///
    /// `children` already yields a `UITabBarController`'s tabs and a `UINavigationController`'s
    /// stack, so the whole tree is reached from the window's root. `visited` guards against
    /// re-entering a node (cheap and keeps the pass non-recursive on cycles).
    #if canImport(UIKit)
    private static func theme(
        controller: UIViewController,
        color: UIColor,
        visited: inout Set<ObjectIdentifier>
    ) {
        guard visited.insert(ObjectIdentifier(controller)).inserted else { return }

        // Containers that are not on screen yet keep a `nil` (transparent) background, which is
        // already correct once their parent is themed, so their views are not force-loaded.
        if controller.isViewLoaded {
            controller.view.backgroundColor = color
        }

        if let tabBarController = controller as? UITabBarController {
            tabBarController.tabBar.backgroundColor = color
            tabBarController.tabBar.isTranslucent = false
        }

        if let navigationController = controller as? UINavigationController {
            let navigationBar = navigationController.navigationBar
            // A pushed screen must not introduce another surface: both the standard and the
            // scroll-edge appearance get the flat theme colour, with the blur and hairline off.
            let standard = navigationBar.standardAppearance
            standard.backgroundColor = color
            standard.backgroundEffect = nil
            standard.shadowColor = .clear
            navigationBar.standardAppearance = standard
            if let scrollEdge = navigationBar.scrollEdgeAppearance {
                scrollEdge.backgroundColor = color
                scrollEdge.backgroundEffect = nil
                scrollEdge.shadowColor = .clear
                navigationBar.scrollEdgeAppearance = scrollEdge
            }
        }

        for child in controller.children {
            theme(controller: child, color: color, visited: &visited)
        }
        if let presented = controller.presentedViewController {
            theme(controller: presented, color: color, visited: &visited)
        }
    }
    #endif

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
        .toolbarBackground(AppTheme.background, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
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
