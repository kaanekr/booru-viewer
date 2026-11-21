import Foundation

enum SmokeFailure: Error {
  case assertion(String)
}

@main
struct Smoke {
  static func check(_ condition: Bool, _ description: String) throws {
    if !condition { throw SmokeFailure.assertion(description) }
  }

  static func main() async throws {
    try testPlaylist()
    try await testDiskCache()
    print("HLS playlist and disk cache smoke tests passed")
  }

  static func testPlaylist() throws {
    let master = URL(string: "https://ev.phncdn.com/hls/video/master.m3u8")!
    var worker = URLComponents(string: "https://relay.example.com/")!
    worker.queryItems = [URLQueryItem(name: "url", value: master.absoluteString)]
    let origin = try HlsOrigin(source: worker.url!)
    let variant = URL(string: "720p/media.m3u8", relativeTo: master)!.absoluteURL
    try check(origin.playlist == master, "Worker media URL should be unwrapped")
    try check(URLComponents(url: origin.requestURL(for: variant)!, resolvingAgainstBaseURL: false)?
      .queryItems?.first?.value == variant.absoluteString, "Segments should follow the same Worker route")
    try check(!origin.permitsRedirect(to: URL(string: "https://other.example.com/")!), "Worker redirects are scoped")
    try check(!HlsOrigin.isAllowed(URL(string: "https://phncdn.com.example.com/segment.ts")!), "CDN look-alike host")

    let manifest = """
    #EXTM3U
    #EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio/index.m3u8"
    #EXT-X-STREAM-INF:BANDWIDTH=900000,AUDIO="audio"
    720p/media.m3u8
    """
    var routes: [HlsResource] = []
    func route(_ resource: HlsResource) -> URL {
      routes.append(resource)
      return URL(string: "http://127.0.0.1:32123/token/\(routes.count)")!
    }
    let rewritten = try HlsPlaylist.rewrite(Data(manifest.utf8), relativeTo: master, route: route)
    try check(routes.map(\.kind) == [.playlist, .playlist], "Audio and video variants should both be proxied")
    try check(routes.last?.url == variant, "Relative variant URL resolution")
    try check(String(decoding: rewritten, as: UTF8.self).contains("URI=\"http://127.0.0.1:32123/token/1\""), "Audio playlist rewrite")
    routes.removeAll()

    let vod = """
    #EXTM3U
    #EXT-X-MAP:URI="video.init.mp4"
    #EXTINF:6,
    block001.m4s
    #EXT-X-ENDLIST
    """
    _ = try HlsPlaylist.rewrite(Data(vod.utf8), relativeTo: variant, route: route)
    try check(routes.map(\.kind) == [.segment(cacheable: true), .segment(cacheable: true)], "VOD segments and init should be cacheable")
    routes.removeAll()
    _ = try HlsPlaylist.rewrite(Data(vod.replacingOccurrences(of: "#EXT-X-ENDLIST", with: "").utf8), relativeTo: variant, route: route)
    try check(routes.last?.kind == .segment(cacheable: false), "Live segments should pass through")
    do {
      _ = try HlsPlaylist.rewrite(Data("#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key\"\nseg.ts".utf8),
        relativeTo: variant, route: route)
      throw SmokeFailure.assertion("Encrypted stream should fall back to normal playback")
    } catch HlsCacheError.unsupportedSource {}

    let a = URL(string: "https://ev.phncdn.com/a.ts?validfrom=1&validto=2&ipa=one&hash=abc&quality=480")!
    let renewed = URL(string: "https://ev.phncdn.com/a.ts?validfrom=3&validto=4&ipa=two&hash=xyz&quality=480")!
    let other = URL(string: "https://ev.phncdn.com/a.ts?validfrom=3&validto=4&hash=xyz&quality=720")!
    try check(HlsOrigin.cacheIdentity(for: a) == HlsOrigin.cacheIdentity(for: renewed), "Recognized CDN signature renewal should reuse a segment")
    try check(HlsOrigin.cacheIdentity(for: other) != HlsOrigin.cacheIdentity(for: renewed), "Quality query must remain in the cache key")
  }

  static func testDiskCache() async throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("booru-hls-test-\(UUID())", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: dir) }
    let cache = HlsSegmentStore(directory: dir)
    await cache.setLimit(16 * 1024)
    let revision = await cache.lookup(asset: "video-1", identity: "first").revision
    let response = HlsResponse(206, headers: ["Content-Range": "bytes 0-3/4"], body: Data([1, 2, 3, 4]))
    await cache.store(response, asset: "video-1", identity: "first", revision: revision)
    let stored = await cache.lookup(asset: "video-1", identity: "first")
    try check(stored.response?.body == response.body, "A completed range should be readable after writing it")
    let reopened = HlsSegmentStore(directory: dir)
    let stats = await reopened.stats()
    try check(stats["files"] == 1 && (stats["bytes"] ?? 0) > 0, "A cold cache should index the saved segment")
    let lookup = await reopened.lookup(asset: "video-1", identity: "first")
    try check(lookup.response?.body == response.body && lookup.response?.status == 206, "A completed range should persist on disk")
    await cache.clear()
    await cache.store(response, asset: "video-1", identity: "second", revision: revision)
    let clearest = await cache.stats()
    try check(clearest["bytes"] == 0, "A transfer started before clear must not refill the cache")
    await cache.setLimit(1)
    let next = await cache.lookup(asset: "video-1", identity: "second").revision
    await cache.store(response, asset: "video-1", identity: "second", revision: next)
    let tooLarge = await cache.stats()
    try check(tooLarge["bytes"] == 0, "A finite limit rejects data that won't fit")
    await cache.setLimit(-1)
    await cache.store(response, asset: "video-1", identity: "second", revision: next)
    await cache.store(response, asset: "video-2", identity: "third", revision: next)
    let unlimited = await cache.stats()
    try check(unlimited["files"] == 2, "Unlimited cache stores both videos after switching from a finite limit")
    await cache.setLimit(0)
    let afterLimit = await cache.stats()
    try check(afterLimit["bytes"] == 0, "A smaller cache limit evicts existing segments")
  }
}
