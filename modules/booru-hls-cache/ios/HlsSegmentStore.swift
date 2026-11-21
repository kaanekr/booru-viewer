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
  private var budget = 0
  private var revision = 0
  private var entries: [URL: Entry]?
  private var bytes = 0

  init(directory: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("booru-hls-segments", isDirectory: true)) {
    self.directory = directory
  }

  private static func digest(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
  }

  private func location(asset: String, identity: String) -> URL {
    directory.appendingPathComponent(Self.digest(asset) + "-" + Self.digest(identity) + ".segment")
  }

  private func loadIndex() {
    guard entries == nil else { return }
    let fm = FileManager.default
    let keys: Set<URLResourceKey> = [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]
    var loaded: [URL: Entry] = [:]
    try? fm.createDirectory(at: directory, withIntermediateDirectories: true)
    for url in (try? fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys))) ?? [] {
      guard url.pathExtension == "segment", let values = try? url.resourceValues(forKeys: keys),
        values.isRegularFile == true, let size = values.fileSize else { continue }
      let asset = String(url.lastPathComponent.prefix(64))
      loaded[url] = Entry(size: size, date: values.contentModificationDate ?? .distantPast, asset: asset)
      bytes += size
    }
    entries = loaded
  }

  func setLimit(_ bytes: Int) {
    budget = max(0, bytes)
    loadIndex()
    evict(to: budget)
  }

  func lookup(asset: String, identity: String) -> (revision: Int, response: HlsResponse?) {
    loadIndex()
    let file = location(asset: asset, identity: identity)
    guard var entry = entries?[file] else { return (revision, nil) }
    guard let data = try? Data(contentsOf: file),
      let response = try? PropertyListDecoder().decode(HlsResponse.self, from: data) else {
      remove(file)
      return (revision, nil)
    }
    entry.date = Date()
    entries?[file] = entry
    try? FileManager.default.setAttributes([.modificationDate: entry.date], ofItemAtPath: file.path)
    return (revision, response)
  }

  func store(_ response: HlsResponse, asset: String, identity: String, revision expectedRevision: Int) {
    guard expectedRevision == revision, !response.body.isEmpty, response.body.count <= Self.maxSegmentBytes,
      response.status == 200 || response.status == 206 else { return }
    loadIndex()
    let file = location(asset: asset, identity: identity)
    guard entries?[file] == nil, let data = try? PropertyListEncoder().encode(response), data.count <= budget else { return }
    evict(to: budget - data.count)
    guard bytes + data.count <= budget else { return }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try data.write(to: file, options: .atomic)
      let date = Date()
      entries?[file] = Entry(size: data.count, date: date, asset: String(file.lastPathComponent.prefix(64)))
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
    for (file, _) in entries.sorted(by: { $0.value.date < $1.value.date }) {
      if bytes <= limit { break }
      remove(file)
    }
  }

  private func remove(_ file: URL) {
    let fm = FileManager.default
    if fm.fileExists(atPath: file.path) {
      do { try fm.removeItem(at: file) } catch { return }
    }
    if let removed = entries?.removeValue(forKey: file) { bytes -= removed.size }
  }
}
