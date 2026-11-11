import CryptoKit
import ExpoModulesCore
import Foundation
import Security

/// Zami's attachments off the JS thread (@-/com.leonsilicon.zami.media): file I/O, AES-CTR
/// and SHA-256 file to file, downloads streamed into files (verified and decrypted on the
/// way), and thumbnails. Nothing large crosses into JS: files go in and out as URIs. The
/// JS side checks arguments first.
public class ZamiMediaModule: Module {
  private let downloads = Downloads()

  public func definition() -> ModuleDefinition {
    Name("ZamiMedia")

    Events("onProgress")

    OnCreate { [weak self] in
      guard let module = self else { return }
      module.downloads.report = { [weak module] body in
        module?.sendEvent("onProgress", body)
      }
    }

    // The app's cache directory, as a `file://` URI ending in `/`.
    Function("cacheDirectory") { () -> String in
      FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].absoluteString
    }

    // Small, synchronous file system calls: a stat and a mkdir.
    Function("exists") { (uri: String) -> Bool in
      guard let url = try? fileURL(uri) else { return false }
      return FileManager.default.fileExists(atPath: url.path)
    }

    Function("makeDirectory") { (uri: String) throws in
      try FileManager.default.createDirectory(
        at: try fileURL(uri), withIntermediateDirectories: true)
    }

    AsyncFunction("list") { (uri: String) -> [String] in
      guard let url = try? fileURL(uri) else { return [] }
      return (try? FileManager.default.contentsOfDirectory(atPath: url.path)) ?? []
    }

    AsyncFunction("move") { (from: String, to: String) throws in
      let source = try fileURL(from)
      let destination = try fileURL(to)
      if FileManager.default.fileExists(atPath: destination.path) {
        try FileManager.default.removeItem(at: destination)
      }
      try FileManager.default.moveItem(at: source, to: destination)
    }

    AsyncFunction("readRange") { (uri: String, offset: Double, length: Int) throws -> Data in
      let handle = try FileHandle(forReadingFrom: try fileURL(uri))
      defer { try? handle.close() }
      try handle.seek(toOffset: UInt64(max(0, offset)))
      return try handle.read(upToCount: max(0, length)) ?? Data()
    }

    AsyncFunction("writeFile") { (uri: String, data: Data) throws in
      let url = try fileURL(uri)
      try prepareParent(url)
      try data.write(to: url)
    }

    AsyncFunction("concat") { (ranges: [FileRange], dest: String) throws -> Double in
      Double(try transform(ranges, into: try fileURL(dest)) { chunk, write in try write(chunk) })
    }

    // A fresh 256-bit key and an IV of 8 random bytes then 8 zero bytes, as Matrix's
    // EncryptedFile v2 has it; the SHA-256 is of the ciphertext.
    AsyncFunction("encrypt") { (ranges: [FileRange], dest: String) throws -> [String: Any] in
      let key = try randomBytes(32)
      let iv = try randomBytes(8) + Data(count: 8)
      let cipher = try AesCtr(key: key, iv: iv)
      var hasher = SHA256()
      let size = try transform(ranges, into: try fileURL(dest)) { chunk, write in
        let out = try cipher.update(chunk)
        hasher.update(data: out)
        try write(out)
      }
      return [
        "key": key.base64EncodedString(), "iv": iv.base64EncodedString(),
        "sha256": Data(hasher.finalize()).base64EncodedString(), "size": Double(size),
      ]
    }

    // Zam's JPEG metadata stripping, byte for byte (JpegStrip): "stripped" with the result
    // in `dest`, "unchanged" for a JPEG it leaves as it is, "notJpeg" for anything else.
    AsyncFunction("stripJpeg") { (src: String, dest: String) throws -> String in
      let bytes = [UInt8](try Data(contentsOf: try fileURL(src), options: .mappedIfSafe))
      guard bytes.count >= 2, bytes[0] == 0xff, bytes[1] == 0xd8 else { return "notJpeg" }
      guard let stripped = JpegStrip.strip(bytes) else { return "unchanged" }
      let url = try fileURL(dest)
      try prepareParent(url)
      try Data(stripped).write(to: url)
      return "stripped"
    }

    AsyncFunction("download") { (request: DownloadRequest, promise: Promise) in
      self.downloads.start(request, promise: promise)
    }

    Function("cancel") { (id: String) in
      self.downloads.cancel(id)
    }

    AsyncFunction("videoThumbnail") {
      (uri: String, dest: String, maxEdge: Double, quality: Double) async throws -> [String: Any] in
      try await videoThumbnail(uri: uri, dest: dest, maxEdge: maxEdge, quality: quality)
    }

    AsyncFunction("imageThumbnail") {
      (uri: String, dest: String, maxEdge: Double, quality: Double) throws -> [String: Any] in
      try imageThumbnail(uri: uri, dest: dest, maxEdge: maxEdge, quality: quality)
    }

    AsyncFunction("prune") { (directory: String, maxBytes: Double) throws -> [String] in
      prune(directory: try fileURL(directory), maxBytes: Int(maxBytes))
    }

    AsyncFunction("remove") { (uris: [String]) in
      for uri in uris {
        if let url = try? fileURL(uri) { try? FileManager.default.removeItem(at: url) }
      }
    }
  }
}

private func randomBytes(_ count: Int) throws -> Data {
  var bytes = Data(count: count)
  let status = bytes.withUnsafeMutableBytes {
    SecRandomCopyBytes(kSecRandomDefault, count, $0.baseAddress!)
  }
  guard status == errSecSuccess else { throw MediaException("No random bytes (\(status))") }
  return bytes
}
