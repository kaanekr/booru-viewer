import SwiftUI
import Foundation

#if canImport(UIKit)
import UIKit
#endif

/// Bottom sheet with the visible post's metadata, copy actions and categorized
/// tags. Mirrors RN `PostInfoModal` (src/components/PostInfoModal.tsx).
///
/// Tap on a tag searches it (`onSelectTag`); long-press / context menu pins it to
/// favorite tags, blacklists it, or copies it.
@MainActor
struct PostInfoSheetView: View {
    let post: BooruPost
    let viewModel: ViewerViewModel
    /// Tap-to-search callback, e.g. `SearchQuery` push in the app layer.
    let onSelectTag: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @State private var toastMessage: String?
    @State private var toastTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            dragHandle
            header

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    postSection
                    tagsSection
                    if let niches = post.niches, !niches.isEmpty {
                        nichesSection(niches)
                    }
                    otherSection
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 40)
            }
            .scrollIndicators(.visible)
        }
        .background(AppTheme.background)
        .overlay(alignment: .top) { toast }
    }

    // MARK: Chrome

    private var dragHandle: some View {
        Capsule()
            .fill(AppTheme.border)
            .frame(width: 36, height: 4.5)
            .padding(.top, 12)
            .padding(.bottom, 6)
    }

    private var header: some View {
        HStack {
            circleButton(system: "xmark") { dismiss() }
            Spacer()
            Text("Info")
                .font(.headline)
                .foregroundStyle(AppTheme.textPrimary)
            Spacer()
            Color.clear.frame(width: 38, height: 38)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private func circleButton(system: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: system)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
                .frame(width: 38, height: 38)
                .background(AppTheme.surface, in: Circle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Sections

    private var postSection: some View {
        section("Post") {
            VStack(spacing: 0) {
                if let title = post.title, !title.isEmpty {
                    row(label: "Title", value: title) { copyToPasteboard(title, label: "Title") }
                    divider
                }
                row(
                    label: "Normal (\(sampleExtension))",
                    value: "\(sampleWidth)px X \(sampleHeight)px"
                ) {
                    copyToPasteboard((post.sampleURL ?? post.previewURL)?.absoluteString ?? "", label: "Normal Image URL")
                }
                divider
                row(
                    label: "Original (\(originalExtension))",
                    value: originalDetail
                ) {
                    copyToPasteboard((post.originalURL ?? post.sampleURL)?.absoluteString ?? "", label: "Image URL")
                }
                divider
                row(
                    label: "Source",
                    value: post.sourceLink?.absoluteString ?? "Unknown / None",
                    icon: "arrow.up.right.square"
                ) {
                    if let link = post.sourceLink {
                        openURL(link)
                    } else {
                        showToast("Source link not available")
                    }
                }
                divider
                row(
                    label: "URL",
                    value: (post.originalURL ?? post.sampleURL)?.absoluteString ?? "Unknown / None"
                ) {
                    copyToPasteboard((post.originalURL ?? post.sampleURL)?.absoluteString ?? "", label: "Image URL")
                }
            }
            .background(AppTheme.card, in: RoundedRectangle(cornerRadius: 14))
        }
    }

    private var tagItems: [PostInfoTagItem] {
        var seen = Set<String>()
        var items: [PostInfoTagItem] = []

        func append(_ tags: [String], _ category: TagCategory) {
            for tag in tags {
                let clean = tag.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !clean.isEmpty, seen.insert(clean).inserted else { continue }
                items.append(PostInfoTagItem(name: clean, category: category))
            }
        }

        // RN order: copyright, character, artist, general, meta (PostInfoModal.tsx:212-216).
        append(post.tags.copyright, .copyright)
        append(post.tags.character, .character)
        append(post.tags.artist, .artist)
        append(post.tags.general, .general)
        append(post.tags.meta, .meta)

        // Fallback for uncategorized posts (PostInfoModal.tsx:219-227).
        if items.isEmpty {
            append(post.allTags, .general)
        }
        return items
    }

    private var tagsSection: some View {
        section("Tags") {
            TagFlowLayout(spacing: 8) {
                ForEach(tagItems, id: \.name) { item in
                    TagChipView(
                        text: item.name,
                        category: item.category,
                        isSelected: viewModel.isPinnedTag(item.name),
                        onTap: { selectTag(item.name) }
                    )
                    .contextMenu {
                        Button {
                            Task { await viewModel.togglePinnedTag(item.name) }
                        } label: {
                            Label(
                                viewModel.isPinnedTag(item.name) ? "Unpin Tag" : "Pin to Favorite Tags",
                                systemImage: "pin"
                            )
                        }
                        Button(role: .destructive) {
                            Task { await viewModel.toggleBlacklistedTag(item.name) }
                        } label: {
                            Label(
                                viewModel.isBlacklistedTag(item.name) ? "Remove from Blacklist" : "Add to Blacklist",
                                systemImage: "eye.slash"
                            )
                        }
                        Button {
                            copyToPasteboard(item.name, label: "Tag")
                        } label: {
                            Label("Copy Tag", systemImage: "doc.on.doc")
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func nichesSection(_ niches: [String]) -> some View {
        section("Niches") {
            TagFlowLayout(spacing: 8) {
                ForEach(niches, id: \.self) { niche in
                    TagChipView(
                        text: niche.replacingOccurrences(of: "-", with: " "),
                        category: .meta,
                        onTap: { selectTag("niche:\(niche)") }
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var otherSection: some View {
        section("Other") {
            VStack(spacing: 0) {
                row(label: "ID", value: post.id) { copyToPasteboard(post.id, label: "Post ID") }
                divider
                row(label: "Posted", value: Self.formatPostedDate(post.createdAt))
                divider
                row(label: "Score", value: String(post.score))
                divider
                row(label: "Rating", value: Self.ratingLabel(post.rating))
            }
            .background(AppTheme.card, in: RoundedRectangle(cornerRadius: 14))
        }
    }

    // MARK: Building blocks

    private func section<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
                .foregroundStyle(AppTheme.textPrimary)
            content()
        }
    }

    private func row(
        label: String,
        value: String,
        icon: String = "doc.on.doc",
        action: (() -> Void)? = nil
    ) -> some View {
        Button {
            action?()
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Text(value)
                        .font(.caption)
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                if action != nil {
                    Image(systemName: icon)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppTheme.primary)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(action == nil)
    }

    private var divider: some View {
        Rectangle()
            .fill(AppTheme.border)
            .frame(height: 0.5)
            .padding(.leading, 14)
    }

    private var toast: some View {
        Group {
            if let toastMessage {
                Text(toastMessage)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(AppTheme.surface, in: Capsule())
                    .overlay(Capsule().stroke(AppTheme.primary, lineWidth: 1))
                    .padding(.top, 56)
            }
        }
    }

    // MARK: Actions

    private func selectTag(_ tag: String) {
        dismiss()
        onSelectTag(tag)
    }

    private func copyToPasteboard(_ text: String, label: String) {
        guard !text.isEmpty else {
            showToast("Nothing to copy")
            return
        }
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        showToast("📋 \(label) copied!")
        #endif
    }

    private func showToast(_ message: String) {
        toastMessage = message
        toastTask?.cancel()
        toastTask = Task {
            try? await Task.sleep(nanoseconds: 2_200_000_000)
            guard !Task.isCancelled else { return }
            toastMessage = nil
        }
    }

    // MARK: Metadata helpers

    private var sampleExtension: String {
        let ext = (post.sampleURL ?? post.previewURL)?.pathExtension ?? ""
        return ext.isEmpty ? "jpg" : ext
    }

    private var originalExtension: String {
        if let ext = post.fileExt, !ext.isEmpty { return ext }
        let ext = post.originalURL?.pathExtension ?? ""
        return ext.isEmpty ? "png" : ext
    }

    /// RN halves overly large sample dimensions (PostInfoModal.tsx:415-416).
    private var sampleWidth: Int {
        post.width > 1200 ? Int((Double(post.width) * 0.5).rounded()) : post.width
    }

    private var sampleHeight: Int {
        post.height > 1200 ? Int((Double(post.height) * 0.5).rounded()) : post.height
    }

    private var originalDetail: String {
        var detail = "\(post.width)px X \(post.height)px"
        if let size = Self.formatBytes(post.fileSize) {
            detail += " • \(size)"
        }
        return detail
    }

    private static func formatBytes(_ bytes: Int?) -> String? {
        guard let bytes, bytes > 0 else { return nil }
        if bytes >= 1024 * 1024 {
            return String(format: "%.1f MB", Double(bytes) / (1024 * 1024))
        }
        return "\(max(1, Int((Double(bytes) / 1024).rounded()))) KB"
    }

    private static func ratingLabel(_ rating: PostRating) -> String {
        switch rating {
        case .safe, .general:
            return "general"
        case .questionable:
            return "questionable"
        case .explicit:
            return "explicit"
        }
    }

    /// RN `formatPostedDate` (PostInfoModal.tsx:253-268): numeric values are epoch
    /// seconds, everything else is parsed as a date string; unparseable input is shown raw.
    private static func formatPostedDate(_ raw: String) -> String {
        guard !raw.isEmpty else { return "Unknown" }

        let date: Date?
        if let seconds = Double(raw) {
            date = Date(timeIntervalSince1970: seconds)
        } else {
            let iso = ISO8601DateFormatter()
            date = iso.date(from: raw)
                ?? {
                    let fractional = ISO8601DateFormatter()
                    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                    return fractional.date(from: raw)
                }()
        }

        guard let date else { return raw }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "d MMM yyyy 'at' HH:mm"
        return formatter.string(from: date)
    }
}

// MARK: - Tag item

/// One categorized post tag rendered as a `TagChipView` in the sheet.
private struct PostInfoTagItem: Hashable {
    let name: String
    let category: TagCategory
}

// MARK: - Tag flow layout
/// Wraps `TagChipView`s like RN's tag list: chip-by-chip, new line when the width
/// is exhausted (PostInfoModal.tsx:640-678).
private struct TagFlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }

        return CGSize(width: maxWidth.isFinite ? maxWidth : x, height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {
        var x = bounds.minX
        var y = bounds.minY
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += lineHeight + lineSpacing
                lineHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: ProposedViewSize(size))
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
