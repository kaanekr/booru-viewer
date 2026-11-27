import ExpoModulesCore
import Foundation
import WebKit

private func matchesCookieDomain(_ cookieDomain: String, target: String) -> Bool {
  let cleanTarget = target.trimmingCharacters(in: .whitespacesAndNewlines)
    .lowercased()
    .trimmingCharacters(in: CharacterSet(charactersIn: "."))
  guard !cleanTarget.isEmpty else { return false }
  let cleanCookie = cookieDomain.trimmingCharacters(in: .whitespacesAndNewlines)
    .lowercased()
    .trimmingCharacters(in: CharacterSet(charactersIn: "."))
  return cleanCookie == cleanTarget || cleanCookie.hasSuffix("." + cleanTarget) || cleanTarget.hasSuffix("." + cleanCookie)
}

@MainActor
private func readWebViewCookies(for domain: String) async -> String {
  var pairs: [String: String] = [:]
  let wkCookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
  for cookie in wkCookies where matchesCookieDomain(cookie.domain, target: domain) {
    pairs[cookie.name] = cookie.value
  }
  if let sharedCookies = HTTPCookieStorage.shared.cookies {
    for cookie in sharedCookies where matchesCookieDomain(cookie.domain, target: domain) {
      if pairs[cookie.name] == nil {
        pairs[cookie.name] = cookie.value
      }
    }
  }
  return pairs.map { "\($0.key)=\($0.value)" }.sorted().joined(separator: "; ")
}

@MainActor
private func removeWebViewCookies(for domain: String) async {
  let store = WKWebsiteDataStore.default().httpCookieStore
  let wkCookies = await store.allCookies()
  for cookie in wkCookies where matchesCookieDomain(cookie.domain, target: domain) {
    await store.deleteCookie(cookie)
  }
  if let sharedCookies = HTTPCookieStorage.shared.cookies {
    for cookie in sharedCookies where matchesCookieDomain(cookie.domain, target: domain) {
      HTTPCookieStorage.shared.deleteCookie(cookie)
    }
  }
}

private actor HlsPlaybackSessions {
  static let shared = HlsPlaybackSessions()
  private var sessions: [String: HlsLoopbackServer] = [:]

  func open(_ source: String, asset: String, headers: [String: String], budget: Int) async -> [String: String]? {
    guard sessions.count < 3, budget == -1 || budget > 0, !asset.isEmpty, asset.count < 200,
      source.count < 8192, let url = URL(string: source), let origin = try? HlsOrigin(source: url) else { return nil }
    let server = HlsLoopbackServer(asset: asset, origin: origin, headers: headers)
    sessions[server.id] = server
    await HlsSegmentStore.shared.setLimit(budget)
    do {
      let local = try await server.start()
      guard sessions[server.id] != nil else { server.close(); return nil }
      return ["id": server.id, "uri": local.absoluteString]
    } catch {
      close(server.id)
      return nil
    }
  }

  func close(_ id: String) {
    sessions.removeValue(forKey: id)?.close()
  }

  func closeAll() {
    for server in sessions.values { server.close() }
    sessions.removeAll()
  }
}

public final class BooruHlsCacheModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BooruHlsCache")

    AsyncFunction("open") { (source: String, asset: String, headers: [String: String], budget: Int) async -> [String: String]? in
      await HlsPlaybackSessions.shared.open(source, asset: asset, headers: headers, budget: budget)
    }
    AsyncFunction("close") { (id: String) async in
      await HlsPlaybackSessions.shared.close(id)
    }
    AsyncFunction("setLimit") { (bytes: Int) async in
      await HlsSegmentStore.shared.setLimit(bytes)
    }
    AsyncFunction("stats") { () async -> [String: Int] in
      await HlsSegmentStore.shared.stats()
    }
    AsyncFunction("clear") { () async in
      await HlsSegmentStore.shared.clear()
    }
    AsyncFunction("getWebViewCookies") { (domain: String) async -> String in
      await readWebViewCookies(for: domain)
    }
    AsyncFunction("clearWebViewCookies") { (domain: String) async in
      await removeWebViewCookies(for: domain)
    }
    OnDestroy {
      Task { await HlsPlaybackSessions.shared.closeAll() }
    }
  }
}
