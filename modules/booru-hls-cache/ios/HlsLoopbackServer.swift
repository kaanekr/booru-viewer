import Foundation
import Network

private actor HlsRoutes {
  private var resources: [String: HlsResource] = [:]
  private var paths: [HlsResource: String] = [:]
  private let root: HlsResource
  private let session: String

  init(root: URL, session: String) {
    self.root = HlsResource(url: root, kind: .playlist)
    self.session = session
  }

  func resource(at path: String) -> HlsResource? {
    path == "/\(session)/master.m3u8" ? root : resources[path]
  }

  func rewrite(_ body: Data, upstream: URL, port: UInt16) throws -> Data {
    try HlsPlaylist.rewrite(body, relativeTo: upstream) { resource in
      let path: String
      if let existing = paths[resource] {
        path = existing
      } else {
        guard resources.count < 12_000 else { throw HlsCacheError.unavailable }
        let ext = resource.kind == .playlist ? "m3u8" : resource.url.pathExtension
        let suffix = ext.range(of: #"^[a-zA-Z0-9]{1,8}$"#, options: .regularExpression) == nil ? "media" : ext
        path = "/\(session)/\(UUID().uuidString).\(suffix)"
        resources[path] = resource
        paths[resource] = path
      }
      guard let url = URL(string: "http://127.0.0.1:\(port)\(path)") else { throw HlsCacheError.unavailable }
      return url
    }
  }
}

private final class HlsRedirectDelegate: NSObject, URLSessionTaskDelegate {
  private let origin: HlsOrigin

  init(origin: HlsOrigin) {
    self.origin = origin
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    guard let url = request.url, origin.permitsRedirect(to: url) else {
      completionHandler(nil)
      return
    }
    completionHandler(request)
  }
}

private struct HlsLocalRequest: Sendable {
  let path: String
  let head: Bool
  let range: String?

  init?(_ data: Data) {
    guard let header = String(data: data, encoding: .utf8) else { return nil }
    let lines = header.components(separatedBy: "\r\n")
    let fields = lines.first?.split(separator: " ") ?? []
    guard fields.count == 3, fields[0] == "GET" || fields[0] == "HEAD",
      fields[1].hasPrefix("/"), fields[2].hasPrefix("HTTP/1.") else { return nil }
    path = String(fields[1]).components(separatedBy: "?")[0]
    head = fields[0] == "HEAD"
    let rangeHeader = lines.first { $0.lowercased().hasPrefix("range:") }
    let value = rangeHeader.map { String($0.dropFirst(6)).trimmingCharacters(in: .whitespaces) }
    if let value, value.range(of: #"^bytes=(?:[0-9]{1,16}-[0-9]{0,16}|-[0-9]{1,16})$"#, options: .regularExpression) == nil {
      return nil
    }
    range = value
  }
}

final class HlsLoopbackServer: @unchecked Sendable {
  let id = UUID().uuidString
  private let asset: String
  private let origin: HlsOrigin
  private let routes: HlsRoutes
  private let headers: [String: String]
  private let http: URLSession
  private let queue = DispatchQueue(label: "booru.hls.loopback", qos: .userInitiated)
  // Listener and connections are confined to queue.
  private var listener: NWListener?
  private var connections: [ObjectIdentifier: NWConnection] = [:]

  init(asset: String, origin: HlsOrigin, headers: [String: String]) {
    self.asset = asset
    self.origin = origin
    self.headers = headers.filter { ["user-agent", "referer", "origin"].contains($0.key.lowercased()) }
    routes = HlsRoutes(root: origin.playlist, session: id)
    let config = URLSessionConfiguration.ephemeral
    config.urlCache = nil
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.httpShouldSetCookies = false
    config.timeoutIntervalForRequest = 10
    config.timeoutIntervalForResource = 20
    config.httpMaximumConnectionsPerHost = 6
    http = URLSession(configuration: config, delegate: HlsRedirectDelegate(origin: origin), delegateQueue: nil)
  }

  func start() async throws -> URL {
    try await withCheckedThrowingContinuation { continuation in
      queue.async {
        do {
          let parameters = NWParameters.tcp
          parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
          let listener = try NWListener(using: parameters)
          self.listener = listener
          listener.stateUpdateHandler = { [weak self, weak listener] state in
            switch state {
            case .ready:
              listener?.stateUpdateHandler = nil
              if let self, let port = listener?.port, let url = URL(string: "http://127.0.0.1:\(port.rawValue)/\(self.id)/master.m3u8") {
                continuation.resume(returning: url)
              } else {
                continuation.resume(throwing: HlsCacheError.unavailable)
              }
            case .failed, .waiting, .cancelled:
              listener?.stateUpdateHandler = nil
              listener?.cancel()
              continuation.resume(throwing: HlsCacheError.unavailable)
            default: break
            }
          }
          listener.newConnectionHandler = { [weak self] connection in
            guard let self else { connection.cancel(); return }
            self.accept(connection)
          }
          listener.start(queue: self.queue)
          self.queue.asyncAfter(deadline: .now() + 2) { [weak listener] in
            if listener?.stateUpdateHandler != nil { listener?.cancel() }
          }
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  func close() {
    queue.async {
      self.listener?.cancel()
      self.listener = nil
      for connection in self.connections.values { connection.cancel() }
      self.connections.removeAll()
      self.http.invalidateAndCancel()
    }
  }

  private func accept(_ connection: NWConnection) {
    guard connections.count < 16, let port = listener?.port else { connection.cancel(); return }
    let key = ObjectIdentifier(connection)
    connections[key] = connection
    connection.stateUpdateHandler = { [weak self, weak connection] state in
      switch state {
      case .failed, .cancelled:
        self?.connections[key] = nil
        connection?.cancel()
      default: break
      }
    }
    connection.start(queue: queue)
    receive(connection, data: Data(), port: port.rawValue)
    queue.asyncAfter(deadline: .now() + 25) { [weak connection] in connection?.cancel() }
  }

  private func receive(_ connection: NWConnection, data: Data, port: UInt16) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 8192) { [weak self] content, _, complete, error in
      guard let self, error == nil else { connection.cancel(); return }
      var buffer = data
      buffer.append(content ?? Data())
      if let end = buffer.range(of: Data("\r\n\r\n".utf8)), end.lowerBound <= 8192 {
        guard let request = HlsLocalRequest(Data(buffer[..<end.lowerBound])) else {
          self.send(HlsResponse(400), head: false, to: connection)
          return
        }
        Task {
          let response = await self.response(for: request, port: port)
          self.queue.async {
            guard self.connections[ObjectIdentifier(connection)] != nil else { return }
            self.send(response, head: request.head, to: connection)
          }
        }
      } else if buffer.count >= 8192 {
        self.send(HlsResponse(431), head: false, to: connection)
      } else if complete {
        connection.cancel()
      } else {
        self.receive(connection, data: buffer, port: port)
      }
    }
  }

  private func response(for request: HlsLocalRequest, port: UInt16) async -> HlsResponse {
    guard let resource = await routes.resource(at: request.path), let upstream = origin.requestURL(for: resource.url) else {
      return HlsResponse(404)
    }
    var remote = URLRequest(url: upstream)
    remote.httpMethod = request.head ? "HEAD" : "GET"
    for (name, value) in headers { remote.setValue(value, forHTTPHeaderField: name) }
    if resource.kind != .playlist { remote.setValue(request.range, forHTTPHeaderField: "Range") }
    let cacheable = !request.head && resource.kind == .segment(cacheable: true)
    let identity = HlsOrigin.cacheIdentity(for: resource.url) + "\n" + (request.range ?? "")
    let lookup = cacheable ? await HlsSegmentStore.shared.lookup(asset: asset, identity: identity) : nil
    if let cached = lookup?.response { return cached }
    do {
      let body: Data
      let response: URLResponse
      if request.head {
        (body, response) = try await http.data(for: remote)
      } else {
        let (file, result) = try await http.download(for: remote)
        defer { try? FileManager.default.removeItem(at: file) }
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= 32 * 1024 * 1024 else { return HlsResponse(502) }
        // The transfer goes to disk first, with a bound on memory used for the reply.
        body = try Data(contentsOf: file)
        response = result
      }
      guard let status = response as? HTTPURLResponse,
        let finalURL = status.url, origin.permitsRedirect(to: finalURL),
        status.statusCode == 200 || status.statusCode == 206 else { return HlsResponse(502) }
      if resource.kind == .playlist && !request.head {
        let transformed = try await routes.rewrite(body,
          upstream: origin.playlistBase(requested: resource.url, response: finalURL), port: port)
        return HlsResponse(200, headers: ["Content-Type": "application/vnd.apple.mpegurl"], body: transformed)
      }
      let passed = ["Content-Type", "Content-Range", "Accept-Ranges"]
      var replyHeaders: [String: String] = [:]
      for name in passed {
        if let value = status.value(forHTTPHeaderField: name), !value.contains("\r"), !value.contains("\n") {
          replyHeaders[name] = value
        }
      }
      if request.head, let length = status.value(forHTTPHeaderField: "Content-Length"), let bytes = Int(length), bytes >= 0 {
        replyHeaders["Content-Length"] = String(bytes)
      }
      let reply = HlsResponse(status.statusCode, headers: replyHeaders, body: body)
      let mime = replyHeaders["Content-Type"]?.lowercased() ?? ""
      if let revision = lookup?.revision, !mime.hasPrefix("text/"), !mime.contains("json"),
        status.value(forHTTPHeaderField: "Cache-Control")?.lowercased().contains("no-store") != true,
        status.statusCode != 206 || replyHeaders["Content-Range"] != nil {
        Task(priority: .utility) {
          await HlsSegmentStore.shared.store(reply, asset: asset, identity: identity, revision: revision)
        }
      }
      return reply
    } catch {
      return HlsResponse(502)
    }
  }

  private func send(_ response: HlsResponse, head: Bool, to connection: NWConnection) {
    var headers = response.headers
    headers["Content-Length"] = headers["Content-Length"] ?? String(response.body.count)
    headers["Connection"] = "close"
    var header = "HTTP/1.1 \(response.status) Response\r\n"
    for (name, value) in headers { header += "\(name): \(value)\r\n" }
    header += "\r\n"
    if head || response.body.isEmpty {
      connection.send(content: Data(header.utf8), completion: .contentProcessed { _ in connection.cancel() })
    } else {
      connection.send(content: Data(header.utf8), completion: .contentProcessed { error in
        if error != nil { connection.cancel(); return }
        connection.send(content: response.body, completion: .contentProcessed { _ in connection.cancel() })
      })
    }
  }
}
