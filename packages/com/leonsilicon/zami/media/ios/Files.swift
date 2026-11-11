import ExpoModulesCore
import Foundation

final class MediaException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    param
  }
}

/// The URL of a `file://` URI (or a plain path).
func fileURL(_ uri: String) throws -> URL {
  if uri.hasPrefix("file://") {
    if let url = URL(string: uri), url.isFileURL { return url }
    let path = String(uri.dropFirst("file://".count))
    return URL(fileURLWithPath: path.removingPercentEncoding ?? path)
  }
  if uri.hasPrefix("/") { return URL(fileURLWithPath: uri) }
  throw MediaException("Not a file URI: \(uri)")
}

/// Makes the directory `url` goes in.
func prepareParent(_ url: URL) throws {
  try FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
}

/// A new, empty file at `url`, open for writing.
func createForWriting(_ url: URL) throws -> FileHandle {
  try prepareParent(url)
  guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
    throw MediaException("Can't create \(url.path)")
  }
  return try FileHandle(forWritingTo: url)
}

/// What native code reads a file in.
let chunkBytes = 1 << 20

/// A range of a file, as the JS side passes it.
struct FileRange: Record {
  @Field var uri: String = ""
  @Field var offset: Double = 0
  @Field var length: Double = 0
}

/// Reads `ranges` a chunk at a time, hands each to `body` with a writer of `dest`, and
/// returns how many bytes were written.
func transform(
  _ ranges: [FileRange],
  into dest: URL,
  _ body: (Data, (Data) throws -> Void) throws -> Void
) throws -> Int {
  let out = try createForWriting(dest)
  defer { try? out.close() }
  var written = 0
  let write: (Data) throws -> Void = { data in
    try out.write(contentsOf: data)
    written += data.count
  }
  for range in ranges {
    guard range.offset >= 0, range.length >= 0 else {
      throw MediaException("Bad range of \(range.uri)")
    }
    let input = try FileHandle(forReadingFrom: try fileURL(range.uri))
    defer { try? input.close() }
    try input.seek(toOffset: UInt64(range.offset))
    var left = Int(range.length)
    while left > 0 {
      let chunk = try autoreleasepool {
        try input.read(upToCount: min(left, chunkBytes)) ?? Data()
      }
      if chunk.isEmpty { throw MediaException("\(range.uri) is shorter than expected") }
      try autoreleasepool { try body(chunk, write) }
      left -= chunk.count
    }
  }
  return written
}

/// Deletes `.part` files left by downloads an hour old or more, and the files modified
/// longest ago until the rest fit in `maxBytes`. Returns the names of the files left.
func prune(directory: URL, maxBytes: Int) -> [String] {
  let keys: Set<URLResourceKey> = [.fileSizeKey, .contentModificationDateKey, .isRegularFileKey]
  guard
    let entries = try? FileManager.default.contentsOfDirectory(
      at: directory, includingPropertiesForKeys: Array(keys))
  else { return [] }
  let stale = Date().addingTimeInterval(-3600)
  var files: [(url: URL, size: Int, modified: Date)] = []
  for url in entries {
    guard let values = try? url.resourceValues(forKeys: keys), values.isRegularFile == true else {
      continue
    }
    let modified = values.contentModificationDate ?? .distantPast
    if url.pathExtension == "part" {
      // A download in progress keeps writing its .part file.
      if modified < stale { try? FileManager.default.removeItem(at: url) }
      continue
    }
    files.append((url, values.fileSize ?? 0, modified))
  }
  files.sort { $0.modified < $1.modified }
  var total = files.reduce(0) { $0 + $1.size }
  var first = 0
  while total > maxBytes, first < files.count {
    try? FileManager.default.removeItem(at: files[first].url)
    total -= files[first].size
    first += 1
  }
  return files[first...].map { $0.url.lastPathComponent }
}
