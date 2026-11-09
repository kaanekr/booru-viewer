import Foundation
import Observation

/// Shared application graph.
///
/// Owns the stores, the network transport, the security services, and the in-memory copies the
/// views render (settings, credentials, favorite keys, blocked tags). It is created once by
/// `BooruViewerApp` and injected into `RootTabView`.
@MainActor
@Observable
final class AppContainer {
    // MARK: - Stores

    /// One JSON actor shared by every file-backed store so read-modify-write is serialized app-wide.
    let fileStore: JSONFileStore
    let settingsStore: SettingsStore
    let favoritesStore: FavoritesStore
    let favoriteTagsStore: TagListStore
    let blacklistedTagsStore: TagListStore
    let searchHistoryStore: SearchHistoryStore
    let recentViewsStore: RecentViewsStore

    // MARK: - Services

    let securityService: SecurityService
    let lockController: AppLockController
    let backupService: BackupService
    let httpClient: URLSessionHTTPClient

    // MARK: - Rendered state

    private(set) var settings = AppSettings()
    /// Keychain-backed credentials; `nil` while unset.
    private(set) var gelbooruAuth: ApiAuth?
    private(set) var rule34Auth: ApiAuth?
    /// Source-qualified `postKey` values currently favorited, used for card badges.
    private(set) var favoriteKeys: Set<String> = []
    /// Raw blocked-tag entries applied to every loaded page.
    private(set) var blacklistedTags: [String] = []

    // MARK: - Init

    init(directory: URL = JSONFileStore.defaultDirectory()) {
        let fileStore = JSONFileStore(directory: directory)
        self.fileStore = fileStore
        self.settingsStore = SettingsStore(file: fileStore)
        self.favoritesStore = FavoritesStore(file: fileStore)
        self.favoriteTagsStore = TagListStore(file: fileStore, kind: .favorite)
        self.blacklistedTagsStore = TagListStore(file: fileStore, kind: .blacklisted)
        self.searchHistoryStore = SearchHistoryStore(file: fileStore)
        self.recentViewsStore = RecentViewsStore(file: fileStore)
        self.httpClient = URLSessionHTTPClient()

        let securityService = SecurityService()
        self.securityService = securityService
        self.lockController = AppLockController(service: securityService, settings: settingsStore)

        self.backupService = BackupService(
            favorites: favoritesStore,
            favoriteTags: favoriteTagsStore,
            blacklistedTags: blacklistedTagsStore,
            searchHistory: searchHistoryStore,
            recentViews: recentViewsStore
        )
    }

    // MARK: - Launch

    /// Loads persisted state, restores credentials, then arms the cold-start lock.
    func bootstrap() async {
        await reloadSharedState()
        await lockController.prepareForLaunch()
    }

    // MARK: - Shared state

    /// Re-reads settings, credentials, favorites, and the blacklist.
    ///
    /// Screens mutate these through their own store handles, so the tabs call this whenever the
    /// selection changes to pick up edits made elsewhere (Settings, Viewer, Backup import).
    func reloadSharedState() async {
        if let loaded = try? await settingsStore.load() {
            settings = loaded
        }
        blacklistedTags = (try? await blacklistedTagsStore.list()) ?? []
        await reloadFavorites()
        await loadCredentials()
    }

    /// Refreshes only the favorite key set, e.g. after the viewer toggled a favorite.
    func reloadFavorites() async {
        let posts = (try? await favoritesStore.list()) ?? []
        favoriteKeys = Set(posts.map(postKey))
    }

    func isFavorite(_ post: BooruPost) -> Bool {
        favoriteKeys.contains(postKey(post))
    }

    /// Adds or removes `post`, then refreshes the in-memory badges.
    func toggleFavorite(_ post: BooruPost) async {
        if isFavorite(post) {
            try? await favoritesStore.remove(id: post.id, sourceID: post.sourceID)
        } else {
            try? await favoritesStore.add(post)
        }
        await reloadFavorites()
    }

    // MARK: - Requests

    /// Per-request dependencies handed to source adapters. Rebuilt so proxy and quality edits
    /// made in Settings reach the next fetch without restarting the app.
    func makeSourceContext() -> SourceContext {
        SourceContext(
            http: ProxyAwareHTTPClient(direct: httpClient, proxy: settings.proxy),
            proxy: settings.proxy,
            gelbooruAuth: gelbooruAuth,
            rule34Auth: rule34Auth,
            imageQuality: settings.imageQuality
        )
    }

    // MARK: - History

    /// Persists an empty recent-views document. `RecentViewsStoring` has no delete operation, so
    /// `FavoritesScreen`'s "Clear History" calls this app-level hook instead.
    func clearRecentViews() async {
        try? await fileStore.write(RecentViewsStore.fileName, [BooruPost]())
    }

    // MARK: - Credentials

    private func loadCredentials() async {
        gelbooruAuth = try? KeychainStore.load(ApiAuth.self, for: KeychainStore.gelbooruAuthAccount)
        rule34Auth = try? KeychainStore.load(ApiAuth.self, for: KeychainStore.rule34AuthAccount)
    }
}
