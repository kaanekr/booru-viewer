import SwiftUI

/// Dark theme tokens for the native UI.
///
/// Values are the exact RN palette entries from `Colors.dark` (src/theme/colors.ts:29-47)
/// and `TagColors` (colors.ts:1-27). There is no light palette: the app is dark-only,
/// like the RN build.
enum AppTheme {
    // MARK: Surfaces

    /// RN `Colors.dark.background`.
    static let background = color(0x0B0D13)
    /// RN `Colors.dark.card`; the post-card and source-row fill.
    static let card = color(0x161922)
    /// RN `Colors.dark.surface`; pills and circular buttons.
    static let surface = color(0x1E2230)
    /// RN `SourceCatalog.tsx:85` selected row fill.
    static let selectedSurface = color(0x181B30)
    /// RN `FeedScreen.tsx:633` inactive quick-filter chip fill.
    static let chip = color(0x181A22)
    /// RN `FeedScreen.tsx:635` inactive quick-filter chip border.
    static let chipBorder = color(0x292D3B)

    // MARK: Text

    /// RN `Colors.dark.text`.
    static let textPrimary = color(0xFFFFFF)
    /// RN `Colors.dark.textSecondary`.
    static let textSecondary = color(0x8E92A4)
    /// RN `Colors.dark.textMuted`.
    static let textMuted = color(0x5C6073)

    // MARK: Accents

    /// RN `Colors.dark.primary`.
    static let primary = color(0x6366F1)
    /// RN `Colors.dark.primaryLight`.
    static let primaryLight = color(0x818CF8)
    /// RN `Colors.dark.accent`.
    static let accent = color(0xEC4899)
    /// RN `Colors.dark.warning`.
    static let warning = color(0xF59E0B)
    /// RN `Colors.dark.danger`.
    static let danger = color(0xEF4444)
    /// RN `Colors.dark.safe`.
    static let success = color(0x10B981)
    /// RN `FeedScreen.tsx:39` selected quick-filter accent.
    static let goldAccent = color(0xF5A623)
    /// RN `FeedScreen.tsx:647` text on the selected quick-filter chip.
    static let goldAccentText = color(0x111216)

    // MARK: Lines

    /// RN `Colors.dark.cardBorder` (rgba(255, 255, 255, 0.08)).
    static let border = Color.white.opacity(0.08)
    /// RN `Colors.dark.divider` (rgba(255, 255, 255, 0.06)).
    static let divider = Color.white.opacity(0.06)

    // MARK: Tag palette

    /// RN `TagColors[category].text` (colors.ts:1-27).
    static func tagColor(for category: TagCategory) -> Color {
        switch category {
        case .artist: return color(0xFF6B6B)
        case .character: return color(0x51CF66)
        case .copyright: return color(0xCC5DE8)
        case .general: return color(0x339AF0)
        case .meta: return color(0xFCC419)
        }
    }

    /// RN `TagColors[category].bg` (alpha 0.15 over the card).
    static func tagBackground(for category: TagCategory) -> Color {
        tagColor(for: category).opacity(0.15)
    }

    /// RN `TagColors[category].border` (alpha 0.3 over the card).
    static func tagBorder(for category: TagCategory) -> Color {
        tagColor(for: category).opacity(0.3)
    }

    // MARK: Rating palette

    /// RN `getRatingColor` (PostCard.tsx:38-50): safe/general green, questionable amber,
    /// explicit red, anything else muted.
    static func ratingColor(for rating: PostRating) -> Color {
        switch rating {
        case .safe, .general: return success
        case .questionable: return warning
        case .explicit: return danger
        }
    }

    // MARK: Hex helper

    /// 0xRRGGBB literal, the same notation the RN theme uses.
    static func color(_ hex: UInt32, opacity: Double = 1) -> Color {
        Color(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}
