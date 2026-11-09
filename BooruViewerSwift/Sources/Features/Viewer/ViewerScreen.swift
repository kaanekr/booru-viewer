import SwiftUI
import Foundation

/// Full-screen paged media viewer, pushed from the Explore / Search / Favorites
/// grids. Mirrors RN `ViewerScreen` + `ImageViewerModal` as a stack screen
/// (src/screens/ViewerScreen.tsx, src/components/ImageViewerModal.tsx).
@MainActor
struct ViewerScreen: View {
    let onSelectTag: (String) -> Void
    let onClose: () -> Void

    @State private var viewModel: ViewerViewModel
    @State private var showControls = true
    @State private var showInfo = false

    /// Live vertical offset of the media while a swipe is in flight, so the
    /// dismiss / info-sheet drag feels attached to the finger
    /// (ImageViewerModal.tsx:1331-1372).
    @State private var verticalDragOffset: CGFloat = 0
    /// Set once a drag has been classified as clearly vertical; horizontal drags
    /// then stay with the paged `TabView`.
    @State private var isVerticalDrag = false
    /// Live horizontal offset of the whole viewer during the left-edge dismiss
    /// (ImageViewerModal.tsx:284-324).
    @State private var edgeDragOffset: CGFloat = 0
    @State private var isEdgeDrag = false
    /// Mirrors the visible page's zoom so the viewer's own drags stand down while
    /// the media pan gesture owns the touch.
    @State private var isMediaZoomed = false

    init(
        posts: [BooruPost],
        initialIndex: Int = 0,
        context: SourceContext,
        recentViews: (any RecentViewsStoring)? = nil,
        favorites: (any FavoritesStoring)? = nil,
        favoriteTags: (any TagListStoring)? = nil,
        blacklistedTags: (any TagListStoring)? = nil,
        onSelectTag: @escaping (String) -> Void,
        onClose: @escaping () -> Void = {}
    ) {
        self.onSelectTag = onSelectTag
        self.onClose = onClose
        _viewModel = State(initialValue: ViewerViewModel(
            posts: posts,
            initialIndex: initialIndex,
            context: context,
            recentViews: recentViews,
            favorites: favorites,
            favoriteTags: favoriteTags,
            blacklistedTags: blacklistedTags
        ))
    }

    var body: some View {
        @Bindable var viewModel = viewModel
        let vm = viewModel

        ZStack {
            AppTheme.background.ignoresSafeArea()

            TabView(selection: $viewModel.currentIndex) {
                ForEach(viewModel.posts.indices, id: \.self) { index in
                    let post = viewModel.posts[index]

                    ZoomableMediaView(
                        post: post,
                        media: viewModel.media(for: post),
                        isLoading: viewModel.isLoading(post),
                        isActive: index == viewModel.currentIndex,
                        isMangaMode: viewModel.isMangaMode && index == viewModel.currentIndex,
                        galleryPages: viewModel.galleryPages(for: post),
                        onSingleTap: { toggleControls() },
                        onZoomChanged: { zoomed in isMediaZoomed = zoomed }
                    )
                    .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()
            .offset(y: verticalDragOffset)
            .opacity(mediaOpacity)
            // Both drags are simultaneous so the `.page` `TabView` keeps its own
            // horizontal paging; each one only acts after deciding the drag belongs
            // to it (dominant axis, left-edge start).
            .simultaneousGesture(verticalDismissGesture)
            .simultaneousGesture(edgeDismissGesture)

            overlays
        }
        .offset(x: edgeDragOffset)
        .statusBarHidden(!showControls)
        .animation(.easeInOut(duration: 0.2), value: showControls)
        .onChange(of: vm.currentIndex) { _, _ in
            resetPagerGestures()
        }
        .onChange(of: isMediaZoomed) { _, zoomed in
            if zoomed { resetVerticalDrag() }
        }
        .task(id: vm.currentIndex) { [vm] in
            await vm.prepareCurrentPage()
        }
        .task { [vm] in
            await vm.loadTagLists()
        }
        .onAppear {
            if viewModel.posts.isEmpty {
                onClose()
            }
        }
        .sheet(isPresented: $showInfo) {
            if let post = viewModel.currentPost {
                PostInfoSheetView(post: post, viewModel: viewModel) { tag in
                    showInfo = false
                    onSelectTag(tag)
                }
                .presentationDragIndicator(.visible)
            }
        }
    }

    // MARK: Dismiss gestures

    /// Swipe down closes the viewer, swipe up opens the info sheet
    /// (ImageViewerModal.tsx:1331-1372, PostPageItem scroll handler).
    ///
    /// It is attached simultaneously with the paged `TabView` and only claims a
    /// drag once it is clearly vertical, so left/right swipes still page.
    private var verticalDismissGesture: some Gesture {
        DragGesture(minimumDistance: 20)
            .onChanged { value in
                guard !isVerticalDismissSuspended else { return }
                let translation = value.translation
                if !isVerticalDrag {
                    guard abs(translation.height) > abs(translation.width) else { return }
                    isVerticalDrag = true
                }
                verticalDragOffset = translation.height
            }
            .onEnded { value in
                guard isVerticalDrag else { return }
                isVerticalDrag = false
                guard !isVerticalDismissSuspended else {
                    resetVerticalDrag()
                    return
                }
                let dy = value.translation.height
                if dy > Self.swipeDownThreshold {
                    resetVerticalDrag()
                    onClose()
                } else if dy < -Self.swipeUpThreshold {
                    resetVerticalDrag(animated: true)
                    showInfo = true
                } else {
                    resetVerticalDrag(animated: true)
                }
            }
    }

    /// Interactive left-edge pan to dismiss (ImageViewerModal.tsx:284-324). Only a
    /// drag that starts inside the left ~24 pt strip and travels sideways tracks;
    /// anything else is left to the pager.
    private var edgeDismissGesture: some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { value in
                guard value.startLocation.x < Self.edgeStripWidth else { return }
                guard !isMediaZoomed else { return }
                let translation = value.translation
                if !isEdgeDrag {
                    guard translation.width > 0,
                          abs(translation.width) > abs(translation.height) else { return }
                    isEdgeDrag = true
                }
                edgeDragOffset = translation.width
            }
            .onEnded { value in
                guard isEdgeDrag else { return }
                isEdgeDrag = false
                let shouldDismiss = !isMediaZoomed
                    && (value.translation.width > Self.edgeDismissThreshold
                        || value.predictedEndTranslation.width > Self.edgePredictedThreshold)
                if shouldDismiss {
                    edgeDragOffset = 0
                    onClose()
                } else {
                    withAnimation(Self.springBack) {
                        edgeDragOffset = 0
                    }
                }
            }
    }

    /// Vertical dismissal is suspended while the page is zoomed (the media pan owns
    /// the drag) and inside the multi-page reader, whose scroll view owns vertical
    /// drags (ImageViewerModal.tsx:1345).
    private var isVerticalDismissSuspended: Bool {
        isMediaZoomed || viewModel.isMangaMode
    }

    /// Fades the media as it is pulled off screen, like RN's dismiss transition.
    private var mediaOpacity: Double {
        guard verticalDragOffset > 0 else { return 1 }
        return Double(max(0.4, 1 - verticalDragOffset / 320))
    }

    private static let swipeDownThreshold: CGFloat = 80
    private static let swipeUpThreshold: CGFloat = 70
    private static let edgeStripWidth: CGFloat = 24
    private static let edgeDismissThreshold: CGFloat = 80
    private static let edgePredictedThreshold: CGFloat = 120
    private static let springBack = Animation.spring(response: 0.32, dampingFraction: 0.86)

    private func resetVerticalDrag(animated: Bool = false) {
        isVerticalDrag = false
        guard animated else {
            verticalDragOffset = 0
            return
        }
        withAnimation(Self.springBack) {
            verticalDragOffset = 0
        }
    }

    private func resetPagerGestures() {
        isMediaZoomed = false
        isVerticalDrag = false
        isEdgeDrag = false
        verticalDragOffset = 0
        edgeDragOffset = 0
    }

    // MARK: Overlays

    private var overlays: some View {
        ZStack(alignment: .top) {
            VStack {
                if showControls {
                    topBar
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
                Spacer()
                if showControls {
                    bottomBar
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)

            toast
        }
    }

    private var topBar: some View {
        HStack(spacing: 12) {
            circleButton(system: "xmark") { onClose() }

            Spacer(minLength: 0)

            badge

            Spacer(minLength: 0)

            circleButton(
                system: "info.circle",
                tint: showInfo ? AppTheme.primary : AppTheme.textPrimary
            ) {
                showInfo = true
            }
        }
    }

    private var badge: some View {
        VStack(spacing: 1) {
            Text(viewModel.currentPost?.sourceName ?? "Booru")
                .font(.caption.weight(.semibold))
                .lineLimit(1)
            Text("\(viewModel.currentIndex + 1) / \(viewModel.posts.count)")
                .font(.caption2)
        }
        .foregroundStyle(AppTheme.textPrimary)
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .background(AppTheme.surface.opacity(0.9), in: Capsule())
    }

    private var bottomBar: some View {
        HStack(spacing: 14) {
            if viewModel.canShowMangaMode {
                circleButton(
                    system: viewModel.isMangaMode ? "book.fill" : "book",
                    tint: viewModel.isMangaMode ? AppTheme.primary : AppTheme.textPrimary
                ) {
                    viewModel.isMangaMode.toggle()
                }
            }

            Spacer(minLength: 0)

            if let post = viewModel.currentPost {
                shareButton(for: post)
            }

            if let post = viewModel.currentPost {
                let isFavorite = viewModel.isFavorite(post)
                circleButton(
                    system: isFavorite ? "heart.fill" : "heart",
                    tint: isFavorite ? AppTheme.danger : AppTheme.textPrimary
                ) {
                    Task { await viewModel.toggleFavorite() }
                }
                .disabled(viewModel.savingFavorite)
            }
        }
    }

    private var toast: some View {
        Group {
            if let message = viewModel.toastMessage {
                Text(message)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(AppTheme.surface, in: Capsule())
                    .overlay(Capsule().stroke(AppTheme.primary, lineWidth: 1))
                    .padding(.top, 64)
            }
        }
    }

    // MARK: Controls

    @ViewBuilder
    private func shareButton(for post: BooruPost) -> some View {
        if let url = viewModel.shareURL(for: post) {
            ShareLink(item: url) {
                circleLabel(system: "square.and.arrow.up")
            }
        } else {
            circleLabel(system: "square.and.arrow.up")
                .opacity(0.4)
        }
    }

    private func circleButton(
        system: String,
        tint: Color = AppTheme.textPrimary,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 44, height: 44)
                .background(AppTheme.surface, in: Circle())
        }
        .buttonStyle(.plain)
    }

    private func circleLabel(system: String) -> some View {
        Image(systemName: system)
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(AppTheme.textPrimary)
            .frame(width: 44, height: 44)
            .background(AppTheme.surface, in: Circle())
    }

    private func toggleControls() {
        withAnimation(.easeInOut(duration: 0.2)) {
            showControls.toggle()
        }
    }
}
