import Foundation

/// Persisted app preferences. Defaults mirror RN: image quality 'auto' and grid previews on (storage.ts:103-139),
/// default source `gelbooru` (sources.ts:113).
struct AppSettings: Codable, Sendable {
    static let minimumCacheLimitMb = 50

    var imageQuality: ImageQuality = .auto
    var gridPreviews: Bool = true
    var cacheLimitMb: Int? = nil
    var activeSourceID: SourceID = .gelbooru
    /// RN `FeedOrder` object (storage.ts:9-14); nil when unset.
    var feedOrder: FeedOrder? = nil
    /// RN HentaiHaven last-episode map (storage.ts HH_LAST_EPISODES_KEY).
    var hentaiHavenLastEpisodes: [String: Int] = [:]
    var proxy: ProxyConfig = ProxyConfig()
    var security: SecurityConfig = SecurityConfig()

    enum CodingKeys: String, CodingKey {
        case imageQuality
        case gridPreviews
        case cacheLimitMb
        case activeSourceID
        case feedOrder
        case hentaiHavenLastEpisodes
        case proxy
        case security
    }

    var cacheLimitBytes: Int {
        guard let cacheLimitMb else { return -1 }
        let (bytes, overflow) = cacheLimitMb.multipliedReportingOverflow(by: 1024 * 1024)
        return overflow ? Int.max : bytes
    }
}

extension AppSettings {
    /// Missing or malformed keys fall back to the defaults, so older or partial settings still load.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        imageQuality = (try? c.decode(ImageQuality.self, forKey: .imageQuality)) ?? .auto
        gridPreviews = (try? c.decode(Bool.self, forKey: .gridPreviews)) ?? true
        if let limit = try? c.decode(Int.self, forKey: .cacheLimitMb), limit >= Self.minimumCacheLimitMb {
            cacheLimitMb = limit
        }
        activeSourceID = (try? c.decode(SourceID.self, forKey: .activeSourceID)) ?? .gelbooru
        feedOrder = try? c.decode(FeedOrder.self, forKey: .feedOrder)
        hentaiHavenLastEpisodes = (try? c.decode([String: Int].self, forKey: .hentaiHavenLastEpisodes)) ?? [:]
        proxy = (try? c.decode(ProxyConfig.self, forKey: .proxy)) ?? ProxyConfig()
        security = (try? c.decode(SecurityConfig.self, forKey: .security)) ?? SecurityConfig()
    }
}
