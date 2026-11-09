import Foundation
import SwiftUI

/// Tag pill, mirroring RN `TagChip` (src/components/TagChip.tsx).
///
/// The tag text is shown with `_` replaced by a space (TagChip.tsx:22), the count is
/// abbreviated exactly like RN (TagChip.tsx:24-28), and the palette comes from
/// `TagColors` through `AppTheme`.
struct TagChipView: View {
    private let text: String
    private let category: TagCategory
    private let count: Int?
    private let isSelected: Bool
    private let onTap: (() -> Void)?

    /// - Parameters:
    ///   - text: raw tag name; underscores are displayed as spaces.
    ///   - category: drives the text/background/border colors.
    ///   - count: optional post count shown in the trailing badge.
    ///   - isSelected: stronger fill and border for an active tag.
    ///   - onTap: when `nil` the chip is not interactive.
    init(
        text: String,
        category: TagCategory = .general,
        count: Int? = nil,
        isSelected: Bool = false,
        onTap: (() -> Void)? = nil
    ) {
        self.text = text
        self.category = category
        self.count = count
        self.isSelected = isSelected
        self.onTap = onTap
    }

    var body: some View {
        if let onTap {
            Button(action: onTap) { chip }
                .buttonStyle(.plain)
                .accessibilityLabel(displayName)
        } else {
            chip
                .accessibilityLabel(displayName)
        }
    }

    private var displayName: String {
        text.replacingOccurrences(of: "_", with: " ")
    }

    private var chip: some View {
        HStack(spacing: 5) {
            Text(displayName)
                .font(.system(size: 13, weight: isSelected ? .bold : .semibold))
                .foregroundStyle(AppTheme.tagColor(for: category))
                .lineLimit(1)
                .truncationMode(.tail)

            if let count {
                Text(Self.abbreviated(count))
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(AppTheme.tagColor(for: category))
                    .opacity(0.85)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(Color.black.opacity(0.15), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(fill, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(AppTheme.tagBorder(for: category), lineWidth: isSelected ? 1.5 : 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 12))
    }

    private var fill: Color {
        isSelected
            ? AppTheme.tagColor(for: category).opacity(0.26)
            : AppTheme.tagBackground(for: category)
    }

    /// RN `formatCount` (TagChip.tsx:24-28): 1.0m above one million, 1.0k above one thousand.
    static func abbreviated(_ value: Int) -> String {
        if value >= 1_000_000 {
            return String(format: "%.1fm", Double(value) / 1_000_000)
        }
        if value >= 1_000 {
            return String(format: "%.1fk", Double(value) / 1_000)
        }
        return String(value)
    }
}
