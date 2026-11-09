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
                        onSingleTap: { toggleControls() }
                    )
                    .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()

            overlays
        }
        .statusBarHidden(!showControls)
        .animation(.easeInOut(duration: 0.2), value: showControls)
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
