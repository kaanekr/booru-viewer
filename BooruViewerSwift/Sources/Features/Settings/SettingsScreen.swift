import SwiftUI

/// Settings tab home.
///
/// Mirrors `src/screens/SettingsScreen.tsx`: a source hero, an experience group
/// (viewing, privacy, blocked tags), and an app/data group (connection, storage, about).
/// Every subpage is pushed from here, so the screen must live inside a `NavigationStack`.
struct SettingsScreen: View {
    @State private var model: SettingsViewModel

    init(viewModel: SettingsViewModel) {
        _model = State(initialValue: viewModel)
    }

    var body: some View {
        @Bindable var model = model

        ZStack {
            AppTheme.background.ignoresSafeArea()

            if model.isLoading && !model.hasLoaded {
                ProgressView()
                    .tint(AppTheme.primaryLight)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        NavigationLink {
                            SourcesSettingsView(model: model)
                        } label: {
                            sourceHero
                        }
                        .buttonStyle(.plain)

                        experienceGroup
                        dataGroup
                        footer
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 4)
                    .padding(.bottom, 32)
                    .frame(maxWidth: 680)
                    .frame(maxWidth: .infinity)
                }
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.large)
        .tint(AppTheme.primary)
        .preferredColorScheme(.dark)
        .task { await model.load() }
        .alert(item: $model.alert) { state in
            Alert(
                title: Text(state.title),
                message: Text(state.message),
                dismissButton: .default(Text("OK"))
            )
        }
    }

    // MARK: - Hero

    private var sourceHero: some View {
        let entry = SourceSheetView.entry(for: model.activeSourceID)

        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("YOUR SOURCE")
                    .font(.system(size: 9, weight: .bold))
                    .kerning(1.5)
                    .foregroundStyle(AppTheme.color(0x9B9FBA))

                Spacer(minLength: 8)

                HStack(spacing: 5) {
                    Circle()
                        .fill(AppTheme.color(0xA6ACFF))
                        .frame(width: 4, height: 4)
                    Text("Selected")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(AppTheme.color(0xAFB4E3))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(AppTheme.primary.opacity(0.05), in: Capsule())
            }

            HStack(spacing: 14) {
                SourceMarkBadge(entry: entry, size: 46)

                VStack(alignment: .leading, spacing: 4) {
                    Text(entry.name)
                        .font(.system(size: 21, weight: .semibold))
                        .foregroundStyle(AppTheme.color(0xF2F3FA))
                    Text("\(entry.kind) • \(entry.host)")
                        .font(.system(size: 11))
                        .foregroundStyle(AppTheme.color(0x959AB4))
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(AppTheme.color(0x9B9FC0))
            }
            .padding(.top, 18)

            HStack(spacing: 7) {
                Image(systemName: "square.stack.3d.up")
                    .font(.system(size: 12, weight: .semibold))
                Text("Browse & manage sources")
                    .font(.system(size: 11))
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 11, weight: .semibold))
            }
            .foregroundStyle(AppTheme.color(0x949AC4))
            .padding(.top, 16)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(Color.white.opacity(0.035))
                    .frame(height: 1)
            }
            .padding(.top, 20)
        }
        .padding(18)
        .background(AppTheme.color(0x171B2C), in: RoundedRectangle(cornerRadius: 22))
        .overlay(
            RoundedRectangle(cornerRadius: 22)
                .stroke(AppTheme.color(0x343953), lineWidth: 1)
        )
        .padding(.bottom, 24)
    }

    // MARK: - Groups

    private var experienceGroup: some View {
        SettingsSection(title: "Your experience") {
            NavigationLink {
                AppearanceSettingsView(model: model)
            } label: {
                SettingsRow(
                    title: "Viewing",
                    subtitle: "Image quality & video previews",
                    systemImage: "photo",
                    value: model.imageQualityName,
                    showsDisclosure: true
                )
            }
            .buttonStyle(.plain)

            NavigationLink {
                AppLockSettingsView(model: model)
            } label: {
                SettingsRow(
                    title: "Privacy & safety",
                    subtitle: "App lock, biometrics & blocked tags",
                    systemImage: "shield",
                    showsDisclosure: true
                )
            }
            .buttonStyle(.plain)

            NavigationLink {
                BlacklistSettingsView(model: model)
            } label: {
                SettingsRow(
                    title: "Blocked tags",
                    subtitle: model.blacklistedTags.isEmpty
                        ? "Nothing blocked"
                        : "\(model.blacklistedTags.count) hidden tag\(model.blacklistedTags.count == 1 ? "" : "s")",
                    systemImage: "eye.slash",
                    isLast: true,
                    showsDisclosure: true
                )
            }
            .buttonStyle(.plain)
        }
        .padding(.bottom, 24)
    }

    private var dataGroup: some View {
        SettingsSection(title: "App & data") {
            NavigationLink {
                NetworkSettingsView(model: model)
            } label: {
                SettingsRow(
                    title: "Connection",
                    subtitle: model.networkSummary,
                    systemImage: "antenna.radiowaves.left.and.right",
                    showsDisclosure: true
                )
            }
            .buttonStyle(.plain)

            NavigationLink {
                BackupSettingsView(model: model)
            } label: {
                SettingsRow(
                    title: "Storage & backup",
                    subtitle: "Cache, history & your library",
                    systemImage: "externaldrive",
                    showsDisclosure: true
                )
            }
            .buttonStyle(.plain)

            NavigationLink {
                AboutSettingsView(model: model)
            } label: {
                SettingsRow(
                    title: "About",
                    systemImage: "info.circle",
                    value: "1.0.0",
                    isLast: true,
                    showsDisclosure: true
                )
            }
            .buttonStyle(.plain)
        }
        .padding(.bottom, 24)
    }

    // MARK: - Footer

    private var footer: some View {
        VStack(spacing: 10) {
            HStack(spacing: 14) {
                Rectangle()
                    .fill(AppTheme.color(0x242839))
                    .frame(height: 1)
                Text("BOORU VIEWER")
                    .font(.system(size: 8, weight: .bold))
                    .kerning(2.2)
                    .foregroundStyle(AppTheme.color(0x656B86))
                Rectangle()
                    .fill(AppTheme.color(0x242839))
                    .frame(height: 1)
            }
            .padding(.horizontal, 26)

            Text("Version 1.0.0")
                .font(.system(size: 10))
                .foregroundStyle(AppTheme.color(0x666C82))
        }
        .padding(.top, 4)
    }
}
