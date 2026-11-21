import Foundation

enum HlsCacheError: Error {
  case unsupportedSource
  case invalidPlaylist
  case unavailable
}

struct HlsResource: Hashable, Sendable {
  enum Kind: Hashable, Sendable {
    case playlist
    case segment(cacheable: Bool)
  }

  let url: URL
  let kind: Kind
}

struct HlsOrigin: Sendable {
  let playlist: URL
  private let worker: URLComponents?

  init(source: URL) throws {
    if let components = URLComponents(url: source, resolvingAgainstBaseURL: false),
      let raw = components.queryItems?.first(where: { $0.name == "url" })?.value,
      let upstream = URL(string: raw), Self.isAllowed(upstream),
      source.scheme == "https" || source.scheme == "http" {
      playlist = upstream
      worker = components
    } else {
      guard Self.isAllowed(source) else { throw HlsCacheError.unsupportedSource }
      playlist = source
      worker = nil
    }
    guard playlist.pathExtension.lowercased() == "m3u8" else { throw HlsCacheError.unsupportedSource }
  }

  static func isAllowed(_ url: URL) -> Bool {
    guard url.scheme == "https", let host = url.host?.lowercased(),
      url.user == nil, url.password == nil, url.port == nil || url.port == 443 else { return false }
    return host == "phncdn.com" || host.hasSuffix(".phncdn.com") ||
      host == "pornhub.com" || host.hasSuffix(".pornhub.com")
  }

  func requestURL(for url: URL) -> URL? {
    guard Self.isAllowed(url) else { return nil }
    guard var worker else { return url }
    worker.queryItems = (worker.queryItems ?? []).filter { $0.name != "url" } + [URLQueryItem(name: "url", value: url.absoluteString)]
    return worker.url
  }

  func permitsRedirect(to target: URL) -> Bool {
    if let worker {
      return target.scheme == worker.scheme && target.host == worker.host && target.port == worker.port
    }
    return Self.isAllowed(target)
  }

  func playlistBase(requested: URL, response: URL?) -> URL {
    if worker == nil, let response, Self.isAllowed(response) { return response }
    return requested
  }

  static func cacheIdentity(for url: URL) -> String {
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url.absoluteString }
    components.fragment = nil
    let query = components.queryItems ?? []
    let signingFields: Set<String> = ["validfrom", "validto", "hash"]
    if signingFields.isSubset(of: query.map(\.name)) {
      let transient = signingFields.union(["ip", "ipa", "rate", "burst"])
      let retained = query.filter { !transient.contains($0.name) }
      components.queryItems = retained.isEmpty ? nil : retained
    }
    return components.string ?? url.absoluteString
  }
}

enum HlsPlaylist {
  private static let uriAttribute = try! NSRegularExpression(pattern: #"([:,])URI="([^"]+)""#)
  private static let playlistTags: Set<String> = [
    "#EXT-X-MEDIA", "#EXT-X-I-FRAME-STREAM-INF", "#EXT-X-RENDITION-REPORT",
  ]

  static func rewrite(_ body: Data, relativeTo base: URL, route: (HlsResource) throws -> URL) throws -> Data {
    guard body.count <= 2 * 1024 * 1024, let text = String(data: body, encoding: .utf8) else {
      throw HlsCacheError.invalidPlaylist
    }
    let lines = text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    guard lines.first == "#EXTM3U" else { throw HlsCacheError.invalidPlaylist }
    let vod = lines.contains { $0.trimmingCharacters(in: .whitespaces) == "#EXT-X-ENDLIST" }
    var nextIsPlaylist = false

    func proxy(_ reference: String, kind: HlsResource.Kind) throws -> String {
      guard !reference.contains("{$"), let target = URL(string: reference, relativeTo: base)?.absoluteURL,
        HlsOrigin.isAllowed(target) else { throw HlsCacheError.unsupportedSource }
      return try route(HlsResource(url: target, kind: kind)).absoluteString
    }

    let rewritten = try lines.map { line -> String in
      let value = line.trimmingCharacters(in: .whitespaces)
      if value.isEmpty { return line }
      if !value.hasPrefix("#") {
        let kind: HlsResource.Kind = nextIsPlaylist ? .playlist : .segment(cacheable: vod)
        nextIsPlaylist = false
        return try proxy(value, kind: kind)
      }
      let tag = value.components(separatedBy: ":").first ?? value
      if tag == "#EXT-X-STREAM-INF" {
        nextIsPlaylist = true
      }
      if tag == "#EXT-X-SESSION-KEY" || (tag == "#EXT-X-KEY" && value != "#EXT-X-KEY:METHOD=NONE") {
        throw HlsCacheError.unsupportedSource
      }
      guard value.contains("URI=") else { return line }
      let kind: HlsResource.Kind
      if playlistTags.contains(tag) {
        kind = .playlist
      } else if tag == "#EXT-X-MAP" || tag == "#EXT-X-PART" || tag == "#EXT-X-PRELOAD-HINT" {
        kind = .segment(cacheable: vod)
      } else {
        throw HlsCacheError.unsupportedSource
      }
      let span = NSRange(value.startIndex..<value.endIndex, in: value)
      guard let match = uriAttribute.firstMatch(in: value, range: span),
        let uriRange = Range(match.range(at: 2), in: value) else { throw HlsCacheError.invalidPlaylist }
      return value.replacingCharacters(in: uriRange, with: try proxy(String(value[uriRange]), kind: kind))
    }
    return Data(rewritten.joined(separator: "\n").utf8)
  }
}
