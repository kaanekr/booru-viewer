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

    /// Paints the navigation bar with the app palette.
    ///
    /// The tab bar is deliberately not configured here: on iOS 26 it draws its own opaque
    /// container that ignores `UITabBarAppearance` (a pure-black band, home indicator included),
    /// so `RootTabView` hides the system tab bar entirely and draws its own floating pill on
    /// `AppTheme.background`. The navigation bar still gets an explicit appearance so pushed
    /// screens never flash another bar colour. Its shadow is cleared because the RN shell draws
    /// no separator line under the bar.
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
