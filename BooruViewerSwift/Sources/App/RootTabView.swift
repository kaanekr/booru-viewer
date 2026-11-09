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

        /// Label under the icon in the floating tab bar.
        var title: String {
            switch self {
            case .explore: return "Explore"
            case .search: return "Search"
            case .favorites: return "Favorites"
            case .settings: return "Settings"
            }
        }

        /// SF Symbol for the floating tab bar (the same icons the system bar used).
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
            // The iOS 26 system tab bar draws its own opaque container (a pure-black band,
            // including the whole home-indicator floor) and ignores `UITabBarAppearance`, so
            // every tab hides it and the shell draws `floatingTabBar` instead.
            TabView(selection: $selectedTab) {
                exploreTab
                    .tabItem { Label(Tab.explore.title, systemImage: Tab.explore.symbol) }
                    .tag(Tab.explore)
                    .toolbar(.hidden, for: .tabBar)

                searchTab
                    .tabItem { Label(Tab.search.title, systemImage: Tab.search.symbol) }
                    .tag(Tab.search)
                    .toolbar(.hidden, for: .tabBar)

                favoritesTab
                    .tabItem { Label(Tab.favorites.title, systemImage: Tab.favorites.symbol) }
                    .tag(Tab.favorites)
                    .toolbar(.hidden, for: .tabBar)

                settingsTab
                    .tabItem { Label(Tab.settings.title, systemImage: Tab.settings.symbol) }
                    .tag(Tab.settings)
                    .toolbar(.hidden, for: .tabBar)
            }
            .tint(AppTheme.primary)
            // Reserves the bar's exact height for the scroll views of every tab, so nothing is
            // clipped at the bottom edge any more (this replaces the old manual bottom padding).
            .safeAreaInset(edge: .bottom, spacing: 0) {
                floatingTabBar
            }

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

    // MARK: - Floating tab bar

    /// Height of the pill (icon + label inside 6pt of inner padding).
    private static let tabBarHeight: CGFloat = 54
    /// Gap between the pill and the screen edges.
    private static let tabBarHorizontalPadding: CGFloat = 16

    /// The shell's own tab bar.
    ///
    /// It lives in `safeAreaInset(edge: .bottom)`, so SwiftUI reserves exactly the height it
    /// occupies for every scroll view and no content is clipped at the bottom edge. The
    /// container behind the pill paints `AppTheme.background` (#0B0D13) and bleeds into the
    /// home-indicator area, so no pure-black region can show through around it.
    private var floatingTabBar: some View {
        HStack(spacing: 2) {
            ForEach(Tab.allCases, id: \.self) { tab in
                tabBarItem(for: tab)
            }
        }
        .padding(6)
        .frame(maxWidth: .infinity)
        .frame(height: Self.tabBarHeight)
        .background { tabBarPill }
        .padding(.horizontal, Self.tabBarHorizontalPadding)
        .padding(.top, 8)
        .background(AppTheme.background.ignoresSafeArea(edges: .bottom))
        .animation(.easeOut(duration: 0.16), value: selectedTab)
    }

    /// `AppTheme.surface` (#1E2230) pill with a hairline `AppTheme.border` stroke and a soft shadow.
    private var tabBarPill: some View {
        RoundedRectangle(cornerRadius: Self.tabBarHeight / 2, style: .continuous)
            .fill(AppTheme.surface)
            .overlay {
                RoundedRectangle(cornerRadius: Self.tabBarHeight / 2, style: .continuous)
                    .strokeBorder(AppTheme.border, lineWidth: 0.5)
            }
            .shadow(color: Color.black.opacity(0.45), radius: 14, x: 0, y: 6)
    }

    private func tabBarItem(for tab: Tab) -> some View {
        let isSelected = selectedTab == tab
        return Button {
            select(tab)
        } label: {
            VStack(spacing: 3) {
                Image(systemName: tab.symbol)
                    .font(.system(size: 17, weight: isSelected ? .semibold : .regular))
                Text(tab.title)
                    .font(.system(size: 10, weight: isSelected ? .semibold : .regular))
                    .lineLimit(1)
            }
            .foregroundStyle(isSelected ? AppTheme.primary : AppTheme.textSecondary)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: 21, style: .continuous)
                        .fill(AppTheme.primary.opacity(0.18))
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tab.title)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    // MARK: - Haptics

    /// Selects a tab from the floating bar.
    ///
    /// Every press - including a re-tap on the current tab - gives the RN light impact. A re-tap
    /// only gives feedback: each screen owns its own scroll-to-top gesture, so there is nothing
    /// for the shell to trigger.
    private func select(_ tab: Tab) {
        Self.playTabSelectionHaptic()
        guard tab != selectedTab else { return }
        selectedTab = tab
    }

    /// Light tap feedback on every tab press, mirroring RN's `Haptics.impactAsync(.Light)`.
    private static func playTabSelectionHaptic() {
        #if canImport(UIKit)
        let generator = UISelectionFeedbackGenerator()
        generator.prepare()
        generator.selectionChanged()
        #endif
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
        .toolbar(.hidden, for: .tabBar)
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
