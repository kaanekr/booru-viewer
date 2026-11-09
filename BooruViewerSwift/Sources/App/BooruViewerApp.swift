import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Application entry point.
///
/// Builds the shared `AppContainer`, shows `RootTabView`, forces the dark appearance, and turns
/// SwiftUI scene-phase changes into the lock controller's `AppScenePhase` events.
@main
@MainActor
struct BooruViewerApp: App {
    @State private var container = AppContainer()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        Self.configureBarAppearance()
    }

    var body: some Scene {
        WindowGroup {
            RootTabView(container: container)
                .preferredColorScheme(.dark)
                .task {
                    await container.bootstrap()
                }
        }
        .onChange(of: scenePhase) { _, phase in
            Task {
                await container.lockController.handleScenePhase(Self.appScenePhase(phase))
            }
        }
    }

    // MARK: - UIKit bars

    /// Paints the navigation bar and the system tab bar with the app palette.
    ///
    /// The tab bar is a real `UITabBar` again, so it needs an explicit opaque appearance:
    /// without one the system container is translucent and composites over the window, which
    /// is what produced the pure-black band (home indicator included). Setting the opaque
    /// background to `AppTheme.background` (#0B0D13), clearing the shadow, and disabling
    /// translucency keeps the whole bar on the theme colour. `RootTabView` additionally
    /// applies `.toolbarBackground` per tab and themes the `UIWindow` behind it.
    private static func configureBarAppearance() {
        #if canImport(UIKit)
        let background = UIColor(AppTheme.background)

        let navigationBarAppearance = UINavigationBarAppearance()
        navigationBarAppearance.configureWithOpaqueBackground()
        navigationBarAppearance.backgroundColor = background
        navigationBarAppearance.shadowColor = .clear
        navigationBarAppearance.titleTextAttributes = [.foregroundColor: UIColor(AppTheme.textPrimary)]
        navigationBarAppearance.largeTitleTextAttributes = [.foregroundColor: UIColor(AppTheme.textPrimary)]

        let navigationBar = UINavigationBar.appearance()
        navigationBar.standardAppearance = navigationBarAppearance
        navigationBar.compactAppearance = navigationBarAppearance
        navigationBar.scrollEdgeAppearance = navigationBarAppearance

        let tabBarAppearance = UITabBarAppearance()
        tabBarAppearance.configureWithOpaqueBackground()
        tabBarAppearance.backgroundColor = background
        tabBarAppearance.shadowColor = .clear

        let normalItemColor = UIColor(AppTheme.textSecondary)
        let selectedItemColor = UIColor(AppTheme.primary)
        let itemAppearances = [
            tabBarAppearance.stackedLayoutAppearance,
            tabBarAppearance.inlineLayoutAppearance,
            tabBarAppearance.compactInlineLayoutAppearance
        ]
        for itemAppearance in itemAppearances {
            itemAppearance.normal.iconColor = normalItemColor
            itemAppearance.normal.titleTextAttributes = [.foregroundColor: normalItemColor]
            itemAppearance.selected.iconColor = selectedItemColor
            itemAppearance.selected.titleTextAttributes = [.foregroundColor: selectedItemColor]
        }

        let tabBar = UITabBar.appearance()
        tabBar.standardAppearance = tabBarAppearance
        tabBar.scrollEdgeAppearance = tabBarAppearance
        tabBar.isTranslucent = false
        tabBar.backgroundColor = background
        #endif
    }

    /// SwiftUI's `ScenePhase` mapped onto the lock controller's own phase type.
    private static func appScenePhase(_ phase: ScenePhase) -> AppScenePhase {
        switch phase {
        case .active:
            return .active
        case .inactive:
            return .inactive
        case .background:
            return .background
        @unknown default:
            return .inactive
        }
    }
}
