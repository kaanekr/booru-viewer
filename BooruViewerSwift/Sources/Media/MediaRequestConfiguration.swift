import Foundation

#if canImport(AVFoundation)
import AVFoundation
#endif
#if canImport(UIKit)
import UIKit
#endif

/// One leg of a media fetch: the URL that will actually be requested, the origin
/// URL the headers are derived from, and whether the leg goes through the worker.
struct MediaRouteAttempt {
    let url: URL
    let originalURL: URL
    let isRelayed: Bool
}

/// Shared media transport policy for native image and video loading.
///
/// Mirrors the RN split between `getMediaHeaders` (src/utils/media.ts:314-358) and
/// `proxyService.proxyUrl` (src/services/proxyService.ts:197-211): every media
/// request carries the browser User-Agent plus the per-host `Referer`/`Origin`,
/// and it is routed through the Cloudflare worker when the toggle is on or the
/// host is TLS-fragile. `MediaImageLoader` adds the one-shot retry that
/// `ProxyAwareHTTPClient` performs for API traffic.
enum MediaRequestConfiguration {
    /// proxyService.ts:98-99/`getMediaHeaders` share this exact UA string.
    static let userAgent = ProxyRelay.neutralUserAgent

    /// Guards `storedProxy`; media loads read it from background actors.
    private static let lock = NSLock()
    private static var storedProxy = ProxyConfig()

    /// Proxy settings in effect for media loads; defaults to the disabled config.
    static func currentProxy() -> ProxyConfig {
        lock.lock()
        defer { lock.unlock() }
        return storedProxy
    }

    /// Called whenever the persisted settings change so loaders pick up the toggle.
    static func updateCurrentProxy(_ proxy: ProxyConfig) {
        lock.lock()
        defer { lock.unlock() }
        storedProxy = proxy
    }

    // MARK: Headers

    /// media.ts:314-358 `getMediaHeaders`: browser UA plus the per-host Referer
    /// (and RedGifs Origin) Booru CDNs require.
    static func headers(for url: URL) -> [String: String] {
        var headers: [String: String] = ["User-Agent": userAgent]
        let raw = url.absoluteString
        // media.ts:322-323: Googlebot hits hand out escaped URLs; decode before matching.
        let target = raw.removingPercentEncoding ?? raw

        if contains(target, "realbooru.com") {
            headers["Referer"] = "https://realbooru.com/"
        } else if contains(target, "gelbooru.com") {
            headers["Referer"] = "https://gelbooru.com/"
        } else if contains(target, "rule34.xxx") || contains(target, "rule34.us") {
            headers["Referer"] = "https://rule34.xxx/"
        } else if contains(target, "danbooru.donmai.us") || contains(target, "cdn.donmai.us") {
            headers["Referer"] = "https://danbooru.donmai.us/"
        } else if contains(target, "yande.re") {
            headers["Referer"] = "https://yande.re/"
        } else if contains(target, "cum.st") || contains(target, "coomer.st") {
            headers["Referer"] = "https://cum.st/"
        } else if contains(target, "xvideos-cdn.com") || contains(target, "xvideos.com") {
            headers["Referer"] = "https://www.xvideos.com/"
        } else if contains(target, "xhamster.com")
            || contains(target, "xhamster-cdn")
            || contains(target, "xhpingcdn.com")
            || contains(target, "xhcdn") {
            headers["Referer"] = "https://xhamster.com/"
        } else if contains(target, "pornhub.com") || contains(target, "phncdn.com") {
            headers["Referer"] = "https://www.pornhub.com/"
        } else if contains(target, "sex.com") || contains(target, "sxccdn.com") {
            headers["Referer"] = "https://www.sex.com/"
        } else if contains(target, "hentaihaven.xxx")
            || contains(target, "coverlanyvd.org")
            || contains(target, "octopusmanifest.org") {
            headers["Referer"] = "https://hentaihaven.xxx/"
        } else if contains(target, "redgifs.com") {
            // media.ts:347-350: media.redgifs.com 403s without a Referer and its
            // token is bound to this Origin.
            headers["Referer"] = "https://www.redgifs.com/"
            headers["Origin"] = "https://www.redgifs.com"
        } else if contains(target, "nhentai.net") {
            headers["Referer"] = "https://nhentai.net/"
        }

        return headers
    }

    /// Headers for one leg: worker legs get the scrubbed neutral set
    /// (proxyService.ts:91-104), direct legs the origin headers.
    static func headers(for attempt: MediaRouteAttempt) -> [String: String] {
        guard attempt.isRelayed else { return headers(for: attempt.originalURL) }
        return ProxyRelay.workerHeaders(
            for: attempt.originalURL,
            headers: headers(for: attempt.originalURL)
        )
    }

    // MARK: Routing

    /// `MediaURLNormalizer` repair, then `proxyUrl` (proxyService.ts:197-211):
    /// relay when the toggle is on or the host is TLS-fragile, otherwise direct.
    static func routedURL(for url: URL, proxy: ProxyConfig? = nil) -> URL {
        routeAttempts(for: url, proxy: proxy).first?.url ?? url
    }

    /// Every leg for `url`, primary first and the alternate leg second (when a
    /// worker makes one possible). The retry mirrors `ProxyAwareHTTPClient`.
    static func routeAttempts(for url: URL, proxy: ProxyConfig? = nil) -> [MediaRouteAttempt] {
        let normalized = MediaURLNormalizer.normalize(url) ?? url
        let cfg = proxy ?? currentProxy()
        let worker = ProxyRelay.normalizedWorkerURL(cfg.workerURL)
        // proxyService.ts:81/201: a URL that already points at the worker is not wrapped again.
        let isAlreadyRelay = worker.map { normalized.absoluteString.hasPrefix($0) } ?? false
        let relay: URL? = isAlreadyRelay ? nil : worker.flatMap {
            ProxyRelay.relayURL(for: normalized, workerURL: $0)
        }
        // proxyService.ts:65-67 and :204-209.
        let relayPreferred = cfg.enabled || ProxyRelay.isTLSFragile(normalized)

        let direct = MediaRouteAttempt(url: normalized, originalURL: normalized, isRelayed: isAlreadyRelay)
        guard let relay, relay != normalized else { return [direct] }
        let relayed = MediaRouteAttempt(url: relay, originalURL: normalized, isRelayed: true)
        return relayPreferred ? [relayed, direct] : [direct, relayed]
    }

    /// A one-leg `URLRequest` carrying the right headers for its route.
    static func makeURLRequest(for url: URL, proxy: ProxyConfig? = nil) -> URLRequest {
        let attempts = routeAttempts(for: url, proxy: proxy)
        let attempt = attempts.first
            ?? MediaRouteAttempt(url: MediaURLNormalizer.normalize(url) ?? url, originalURL: url, isRelayed: false)
        var request = URLRequest(url: attempt.url)
        request.timeoutInterval = 30
        request.httpShouldHandleCookies = !attempt.isRelayed
        for (name, value) in headers(for: attempt) {
            request.setValue(value, forHTTPHeaderField: name)
        }
        return request
    }

    // MARK: Video

    #if canImport(AVFoundation)
    /// `AVPlayerItem` that routes like the image loader and carries the
    /// `Referer`/`User-Agent` headers AVPlayer would otherwise omit.
    static func makePlayerItem(for url: URL, proxy: ProxyConfig? = nil) -> AVPlayerItem {
        let attempts = routeAttempts(for: url, proxy: proxy)
        if let attempt = attempts.first {
            return makePlayerItem(for: attempt)
        }
        let normalized = MediaURLNormalizer.normalize(url) ?? url
        return makePlayerItem(for: MediaRouteAttempt(url: normalized, originalURL: normalized, isRelayed: false))
    }

    /// `AVPlayerItem` for an explicit route leg (used for the one-shot retry).
    static func makePlayerItem(for attempt: MediaRouteAttempt) -> AVPlayerItem {
        let options: [String: Any] = ["AVURLAssetHTTPHeaderFieldsKey": headers(for: attempt)]
        let asset = AVURLAsset(url: attempt.url, options: options)
        return AVPlayerItem(asset: asset)
    }
    #endif

    // MARK: Helpers

    /// Case-insensitive substring test, like the RN `/host/i` regexes.
    private static func contains(_ value: String, _ needle: String) -> Bool {
        value.range(of: needle, options: .caseInsensitive) != nil
    }
}

#if canImport(UIKit)
/// Shared in-memory image loader with the proxy fallback the RN media path gets
/// from `proxyService.fetchWithFallback` (proxyService.ts:106-151).
actor MediaImageLoader {
    static let shared = MediaImageLoader()

    private let cache = NSCache<NSString, UIImage>()
    private var inFlight: [NSString: Task<UIImage, Error>] = [:]
    private let session: URLSession

    init(session: URLSession? = nil) {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.requestCachePolicy = .useProtocolCachePolicy
        self.session = session ?? URLSession(configuration: configuration)
        cache.countLimit = 240
        cache.totalCostLimit = 96 * 1024 * 1024
    }

    /// Cache hit check usable before a `task` spends time on the actor hop.
    func cachedImage(for url: URL) -> UIImage? {
        cache.object(forKey: MediaImageLoader.cacheKey(for: url))
    }

    /// Decoded image for `url`, relay-first with a single alternate-leg retry.
    func image(for url: URL, proxy: ProxyConfig? = nil) async throws -> UIImage {
        let key = MediaImageLoader.cacheKey(for: url)
        if let cached = cache.object(forKey: key) {
            return cached
        }
        // Coalesce concurrent requests for the same asset (grid + preview).
        if let pending = inFlight[key] {
            return try await pending.value
        }
        let session = self.session
        let task = Task<UIImage, Error> { [session] in
            try await MediaImageLoader.fetchImage(for: url, proxy: proxy, session: session)
        }
        inFlight[key] = task

        let image: UIImage
        do {
            image = try await task.value
        } catch {
            inFlight[key] = nil
            throw error
        }
        inFlight[key] = nil
        cache.setObject(image, forKey: key, cost: MediaImageLoader.cost(of: image))
        return image
    }

    /// Drops every cached image (settings changes, memory warnings).
    func clearCache() {
        cache.removeAllObjects()
    }

    // MARK: Fetch

    private static func fetchImage(for url: URL, proxy: ProxyConfig?, session: URLSession) async throws -> UIImage {
        let attempts = MediaRequestConfiguration.routeAttempts(for: url, proxy: proxy)
        let legs = attempts.isEmpty
            ? [MediaRouteAttempt(url: MediaURLNormalizer.normalize(url) ?? url, originalURL: url, isRelayed: false)]
            : attempts

        var lastError: Error = BooruError.network("Media request failed")
        for attempt in legs {
            try Task.checkCancellation()
            var request = URLRequest(url: attempt.url)
            request.timeoutInterval = 30
            request.httpShouldHandleCookies = !attempt.isRelayed
            for (name, value) in MediaRequestConfiguration.headers(for: attempt) {
                request.setValue(value, forHTTPHeaderField: name)
            }
            do {
                let (data, response) = try await session.data(for: request)
                if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                    lastError = BooruError.network("Media request failed with status \(http.statusCode)")
                    continue
                }
                guard let image = UIImage(data: data) else {
                    lastError = BooruError.network("Media payload was not a decodable image")
                    continue
                }
                return image
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                lastError = error
                continue
            }
        }
        throw lastError
    }

    private static func cacheKey(for url: URL) -> NSString {
        (MediaURLNormalizer.normalize(url) ?? url).absoluteString as NSString
    }

    private static func cost(of image: UIImage) -> Int {
        Int(image.size.width * image.scale * image.size.height * image.scale * 4)
    }
}
#endif
