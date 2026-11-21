import CryptoKit
import Foundation

struct HlsResponse: Codable, Sendable {
  let status: Int
  let headers: [String: String]
  let body: Data

  init(_ status: Int, headers: [String: String] = [:], body: Data = Data()) {
    self.status = status
    self.headers = headers
    self.body = body
  }
}

actor HlsSegmentStore {
  static let shared = HlsSegmentStore()
  static let maxSegmentBytes = 16 * 1024 * 1024

  private struct Entry {
    var size: Int
    var date: Date
    let asset: String
  }

  private let directory: URL
  private var budget: Int?
  private var revision = 0
  private var entries: [String: Entry]?
  private var bytes = 0

  init(directory: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("booru-hls-segments", isDirectory: true)) {
    self.directory = directory
  }

  private static func digest(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private func filename(asset: String, identity: String) -> String {
    Self.digest(asset) + "-" + Self.digest(identity) + ".segment"
  }

  private func loadIndex() {
    guard entries == nil else { return }
    let fm = FileManager.default
    let keys: Set<URLResourceKey> = [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]
    var loaded: [String: Entry] = [:]
    try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
    for url in (try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys))) ?? [] {
      guard url.pathExtension == "segment", let values = try? url.resourceValues(forKeys: keys),
        values.isRegularFile == true, let size = values.fileSize else { continue }
      let name = url.lastPathComponent
      let asset = String(name.prefix(64))
      loaded[name] = Entry(size: size, date: values.contentModificationDate ?? .distantPast, asset: asset)
      bytes += size
    }
    entries = loaded
  }

  func setLimit(_ bytes: Int) {
    budget = bytes < 0 ? nil : bytes
    if let budget {
      loadIndex()
      evict(to: budget)
    }
  }

  func lookup(asset: String, identity: String) -> (revision: Int, response: HlsResponse?) {
    loadIndex()
    let name = filename(asset: asset, identity: identity)
    guard var entry = entries?[name] else { return (revision, nil) }
    let file = directory.appendingPathComponent(name)
    guard let data = try? Data(contentsOf: file),
      let response = try? PropertyListDecoder().decode(HlsResponse.self, from: data) else {
      remove(name)
      return (revision, nil)
    }
    entry.date = Date()
    entries?[name] = entry
    try? FileManager.default.setAttributes([.modificationDate: entry.date], ofItemAtPath: file.path)
    return (revision, response)
  }

  func store(_ response: HlsResponse, asset: String, identity: String, revision expectedRevision: Int) {
    guard expectedRevision == revision, !response.body.isEmpty, response.body.count <= Self.maxSegmentBytes,
      response.status == 200 || response.status == 206 else { return }
    loadIndex()
    let name = filename(asset: asset, identity: identity)
    guard entries?[name] == nil, let data = try? PropertyListEncoder().encode(response) else { return }
    if let budget {
      guard data.count <= budget else { return }
      evict(to: budget - data.count)
      guard bytes + data.count <= budget else { return }
    }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try data.write(to: directory.appendingPathComponent(name), options: .atomic)
      let date = Date()
      entries?[name] = Entry(size: data.count, date: date, asset: String(name.prefix(64)))
      bytes += data.count
    } catch {
      // Cache IO is optional for playback.
    }
  }

  func stats() -> [String: Int] {
    loadIndex()
    return ["bytes": bytes, "files": Set(entries?.values.map(\.asset) ?? []).count]
  }

  func clear() {
    revision += 1
    loadIndex()
    evict(to: 0)
  }

  private func evict(to limit: Int) {
    guard bytes > limit, let entries else { return }
    for (name, _) in entries.sorted(by: { $0.value.date < $1.value.date }) {
      if bytes <= limit { break }
      remove(name)
    }
  }

  private func remove(_ name: String) {
    let fm = FileManager.default
    let file = directory.appendingPathComponent(name)
    if fm.fileExists(atPath: file.path) {
      do { try fm.removeItem(at: file) } catch { return }
    }
    if let removed = entries?.removeValue(forKey: name) { bytes -= removed.size }
  }
}
