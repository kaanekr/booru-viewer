import SwiftUI

/// Favorites tab with three segments: saved posts (source filter), favorite tags, and recent views.
/// Mirrors RN `FavoritesScreen.tsx`.
@MainActor
struct FavoritesScreen: View {
    @State private var model: FavoritesViewModel

    private let imageQuality: ImageQuality
    private let gridPreviewsEnabled: Bool
    private let isActive: Bool
    private let onOpenPost: ([BooruPost], Int) -> Void
    private let onSelectTag: (String) -> Void

    @State private var newTagText = ""
    @State private var isConfirmingClear = false
    @State private var pendingRemoval: BooruPost? = nil

    private static let gridColumns = [
        GridItem(.flexible(), spacing: 12),
        GridItem(.flexible(), spacing: 12)
    ]

    /// - Parameters:
    ///   - favoritesStore: saved posts.
    ///   - tagStore: the favorite-tag list (`TagListStore.Kind.favorite`).
    ///   - recentViewsStore: recently viewed posts.
    ///   - clearRecentViews: persistence hook for the "Clear History" action; the store protocol
    ///     exposes no delete, so the app layer supplies it.
    ///   - isActive: the tab is on screen; turning true reloads all three lists (RN `isActive`).
    ///   - onSelectTag: favorite-tag tap; the app layer pushes a search for the tag.
    ///   - onOpenPost: opens the viewer at `index` inside the tapped list.
    init(
        favoritesStore: any FavoritesStoring,
        tagStore: any TagListStoring,
        recentViewsStore: any RecentViewsStoring,
        clearRecentViews: (() async -> Void)? = nil,
        isActive: Bool = true,
        imageQuality: ImageQuality = .auto,
        gridPreviewsEnabled: Bool = true,
        onSelectTag: @escaping (String) -> Void = { _ in },
        onOpenPost: @escaping ([BooruPost], Int) -> Void = { _, _ in }
    ) {
        self.imageQuality = imageQuality
        self.gridPreviewsEnabled = gridPreviewsEnabled
        self.isActive = isActive
        self.onSelectTag = onSelectTag
        self.onOpenPost = onOpenPost
        _model = State(initialValue: FavoritesViewModel(
            favoritesStore: favoritesStore,
            tagStore: tagStore,
            recentViewsStore: recentViewsStore,
            clearRecentViews: clearRecentViews
        ))
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Section", selection: segmentBinding) {
                ForEach(FavoritesViewModel.Segment.allCases) { segment in
                    Text(segment.title).tag(segment)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 10)

            switch model.segment {
            case .savedPosts:
                savedPostsSection
            case .favoriteTags:
                favoriteTagsSection
            case .recentViews:
                recentViewsSection
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle("Favorites")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: model.segment) { await model.load() }
        .onChange(of: isActive) { _, active in
            guard active else { return }
            Task { await model.load() }
        }
        .confirmationDialog(
            "Clear History",
            isPresented: $isConfirmingClear,
            titleVisibility: .visible
        ) {
            Button("Clear", role: .destructive) {
                Task { await model.clearRecentViews() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to delete all recently viewed posts?")
        }
        .confirmationDialog(
            "Remove from favorites?",
            isPresented: removalConfirmationBinding,
            titleVisibility: .visible
        ) {
            Button("Remove", role: .destructive) {
                guard let post = pendingRemoval else { return }
                pendingRemoval = nil
                Task { await model.removeFavorite(post) }
            }
            Button("Cancel", role: .cancel) { pendingRemoval = nil }
        }
    }

    // MARK: Saved posts

    private var savedPostsSection: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                sourceFilterBar
                if model.isLoading {
                    ProgressView()
                        .tint(AppTheme.primary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                } else if model.visibleFavorites.isEmpty {
                    emptyState(
                        systemImage: "heart",
                        title: model.sourceFilter == nil ? "No saved posts yet" : "Nothing from this source",
                        message: "Posts you save are collected here."
                    )
                } else {
                    grid(posts: model.visibleFavorites, onLongPress: { pendingRemoval = $0 })
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 20)
        }
        .refreshable { await model.load() }
    }

    private var sourceFilterBar: some View {
        HStack(spacing: 10) {
            Menu {
                Button {
                    model.sourceFilter = nil
                } label: {
                    if model.sourceFilter == nil {
                        Label("All Sources", systemImage: "checkmark")
                    } else {
                        Text("All Sources")
                    }
                }
                ForEach(model.sourceCounts) { summary in
                    Button {
                        model.sourceFilter = summary.id
                    } label: {
                        if model.sourceFilter == summary.id {
                            Label("\(summary.name) (\(summary.count))", systemImage: "checkmark")
                        } else {
                            Text("\(summary.name) (\(summary.count))")
                        }
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                    Text(model.selectedSourceName)
                        .lineLimit(1)
                    Image(systemName: "chevron.down")
                        .font(.caption2)
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(AppTheme.primary)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(AppTheme.card, in: Capsule())
                .overlay(Capsule().stroke(AppTheme.border, lineWidth: 1))
            }
            Spacer(minLength: 0)
            Text("\(model.visibleFavorites.count)")
                .font(.footnote)
                .foregroundStyle(AppTheme.textSecondary)
        }
    }

    // MARK: Favorite tags

    private var favoriteTagsSection: some View {
        List {
            Section {
                HStack(spacing: 8) {
                    TextField("Add a tag", text: $newTagText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit(submitNewTag)
                        .foregroundStyle(AppTheme.textPrimary)
                    Button("Add", action: submitNewTag)
                        .font(.footnote.weight(.semibold))
                        .disabled(newTagText.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }

            Section("Favorite Tags (\(model.favoriteTags.count))") {
                if model.favoriteTags.isEmpty {
                    Text("No favorite tags yet")
                        .foregroundStyle(AppTheme.textSecondary)
                } else {
                    ForEach(model.favoriteTags, id: \.self) { tag in
                        HStack(spacing: 10) {
                            TagChipView(text: tag, onTap: { onSelectTag(tag) })
                            Spacer(minLength: 0)
                            Button {
                                Task { await model.removeFavoriteTag(tag) }
                            } label: {
                                Image(systemName: "trash")
                                    .foregroundStyle(AppTheme.danger)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Remove \(tag)")
                        }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .refreshable { await model.load() }
    }

    private func submitNewTag() {
        let tag = newTagText
        guard !tag.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        newTagText = ""
        Task { await model.addFavoriteTag(tag) }
    }

    // MARK: Recent views

    private var recentViewsSection: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    Text("\(model.recentViews.count) posts")
                        .font(.footnote)
                        .foregroundStyle(AppTheme.textSecondary)
                    Spacer(minLength: 0)
                    Button(role: .destructive) {
                        isConfirmingClear = true
                    } label: {
                        Label("Clear", systemImage: "trash")
                            .font(.footnote.weight(.semibold))
                    }
                    .disabled(model.recentViews.isEmpty)
                    .accessibilityLabel("Clear recent views")
                }

                if model.isLoading {
                    ProgressView()
                        .tint(AppTheme.primary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 60)
                } else if model.recentViews.isEmpty {
                    emptyState(
                        systemImage: "clock.arrow.circlepath",
                        title: "No recent views",
                        message: "Posts you open appear here."
                    )
                } else {
                    grid(posts: model.recentViews, onLongPress: nil)
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 20)
        }
        .refreshable { await model.load() }
    }

    // MARK: Shared pieces

    private func grid(posts: [BooruPost], onLongPress: ((BooruPost) -> Void)?) -> some View {
        LazyVGrid(columns: Self.gridColumns, spacing: 12) {
            ForEach(posts.indices, id: \.self) { index in
                let post = posts[index]
                let longPress: (() -> Void)? = onLongPress.map { handler in { handler(post) } }
                PostCardView(
                    post: post,
                    imageQuality: imageQuality,
                    gridPreviewsEnabled: gridPreviewsEnabled,
                    isFavorite: model.isFavorite(post),
                    onTap: { onOpenPost(posts, index) },
                    onLongPress: longPress
                )
            }
        }
    }

    private func emptyState(systemImage: String, title: String, message: String) -> some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(message)
        }
        .foregroundStyle(AppTheme.textSecondary)
        .padding(.top, 40)
    }

    private var removalConfirmationBinding: Binding<Bool> {
        Binding(
            get: { pendingRemoval != nil },
            set: { isPresented in
                if !isPresented {
                    pendingRemoval = nil
                }
            }
        )
    }

    private var segmentBinding: Binding<FavoritesViewModel.Segment> {
        Binding(
            get: { model.segment },
            set: { model.segment = $0 }
        )
    }
}
