import ExpoModulesCore
import Foundation

private actor HlsPlaybackSessions {
  static let shared = HlsPlaybackSessions()
  private var sessions: [String: HlsLoopbackServer] = [:]

  func open(_ source: String, asset: String, headers: [String: String], budget: Int) async -> [String: String]? {
    guard sessions.count < 3, budget > 0, !asset.isEmpty, asset.count < 200,
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
    OnDestroy {
      Task { await HlsPlaybackSessions.shared.closeAll() }
    }
  }
}
