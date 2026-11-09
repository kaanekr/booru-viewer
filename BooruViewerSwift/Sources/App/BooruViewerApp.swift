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

    /// Paints the tab bar and the navigation bar with the app palette.
    ///
    /// A bare `TabView` keeps UIKit's default opaque tab-bar background, which is pure black and
    /// reads as a solid strip under the content. Applying an explicit `UITabBarAppearance` with
    /// `AppTheme.background` (#0B0D13) both for the standard and the scroll-edge appearance keeps
    /// the bar identical to the rest of the window; the same treatment on `UINavigationBar` stops
    /// pushed screens from flashing another bar colour. Shadows are cleared because the RN shell
    /// draws no separator line above the bar.
    private static func configureBarAppearance() {
        #if canImport(UIKit)
        let background = UIColor(AppTheme.background)
        let normalTint = UIColor(AppTheme.textMuted)
        let selectedTint = UIColor(AppTheme.primary)

        let tabBarAppearance = UITabBarAppearance()
        tabBarAppearance.configureWithOpaqueBackground()
        tabBarAppearance.backgroundColor = background
        tabBarAppearance.shadowColor = .clear

        // Item colours: muted grey at rest, brand indigo when selected (RN tabBar*TintColor).
        for itemAppearance in [
            tabBarAppearance.stackedLayoutAppearance,
            tabBarAppearance.inlineLayoutAppearance,
            tabBarAppearance.compactInlineLayoutAppearance
        ] {
            itemAppearance.normal.iconColor = normalTint
            itemAppearance.normal.titleTextAttributes = [.foregroundColor: normalTint]
            itemAppearance.selected.iconColor = selectedTint
            itemAppearance.selected.titleTextAttributes = [.foregroundColor: selectedTint]
        }

        let tabBar = UITabBar.appearance()
        tabBar.standardAppearance = tabBarAppearance
        tabBar.scrollEdgeAppearance = tabBarAppearance

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
