import CryptoKit
import ExpoModulesCore
import Foundation

/// A download as the JS side asks for it.
struct DownloadRequest: Record {
  @Field var id: String = ""
  @Field var url: String = ""
  @Field var headers: [String: String] = [:]
  @Field var dest: String = ""
  @Field var key: String?
  @Field var iv: String?
  @Field var sha256: String?
}

/// One transfer: the response streams into `<dest>.part` (decrypted, if it is an encrypted
/// attachment, with the SHA-256 of the ciphertext taken on the way), which becomes `dest`
/// only once complete and, for an attachment, verified.
private final class Transfer {
  let id: String
  let promise: Promise
  let dest: URL
  let part: URL
  let cipher: AesCtr?
  let expectedHash: Data?
  var hasher = SHA256()
  var handle: FileHandle?
  var status = 0
  var contentType: String?
  var total: Int64 = -1
  var loaded: Int64 = 0
  var lastReport = Date.distantPast
  var failure: Error?

  init(id: String, promise: Promise, dest: URL, cipher: AesCtr?, expectedHash: Data?) {
    self.id = id
    self.promise = promise
    self.dest = dest
    part = dest.appendingPathExtension("part")
    self.cipher = cipher
    self.expectedHash = expectedHash
  }

  func open() throws {
    handle = try createForWriting(part)
  }

  func write(_ data: Data) throws {
    var out = data
    if let cipher {
      hasher.update(data: data)
      out = try cipher.update(data)
    }
    try handle?.write(contentsOf: out)
    loaded += Int64(data.count)
  }

  func close() {
    try? handle?.close()
    handle = nil
  }

  func discard() {
    try? FileManager.default.removeItem(at: part)
  }

  func finish() throws {
    if let expectedHash, Data(hasher.finalize()) != expectedHash {
      throw MediaException("Attachment integrity check failed (hash mismatch)")
    }
    if FileManager.default.fileExists(atPath: dest.path) {
      try FileManager.default.removeItem(at: dest)
    }
    try FileManager.default.moveItem(at: part, to: dest)
  }
}

/// Downloads into files, off the JS thread, reporting progress at most every 100 ms.
final class Downloads: NSObject, URLSessionDataDelegate {
  /// Where progress goes (the module's `onProgress` event), set when the module is created.
  var report: (([String: Any]) -> Void)?
  /// Serial: every delegate callback and every change to `transfers` runs on it.
  private let queue: OperationQueue = {
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    queue.name = "ZamiMedia.downloads"
    return queue
  }()
  // Made in init, not lazily: downloads start from more than one thread. The session
  // keeps its delegate (this) for as long as the module lives.
  private var session: URLSession!
  private var transfers: [Int: Transfer] = [:]
  private var tasks: [String: URLSessionDataTask] = [:]
  /// Ids cancelled before their download had started (`start` runs on another thread).
  private var cancelledEarly: Set<String> = []
  private let lock = NSLock()

  override init() {
    super.init()
    session = URLSession(configuration: .default, delegate: self, delegateQueue: queue)
  }

  func start(_ request: DownloadRequest, promise: Promise) {
    guard let url = URL(string: request.url) else {
      promise.reject("ERR_DOWNLOAD", "Not a URL: \(request.url)")
      return
    }
    let dest: URL
    var cipher: AesCtr?
    var expectedHash: Data?
    do {
      dest = try fileURL(request.dest)
      if let key = request.key, let iv = request.iv, let sha256 = request.sha256 {
        guard let key = Data(base64Encoded: key), let iv = Data(base64Encoded: iv),
          let hash = Data(base64Encoded: sha256), hash.count == 32
        else { throw MediaException("Bad attachment key, IV or hash") }
        cipher = try AesCtr(key: key, iv: iv)
        expectedHash = hash
      }
    } catch {
      promise.reject(error)
      return
    }
    var urlRequest = URLRequest(url: url)
    for (name, value) in request.headers {
      urlRequest.setValue(value, forHTTPHeaderField: name)
    }
    let transfer = Transfer(
      id: request.id, promise: promise, dest: dest, cipher: cipher, expectedHash: expectedHash)
    // Made and registered under the lock, so a cancel lands either before (and is seen
    // here) or after (and finds the task).
    let task: URLSessionDataTask? = lock.withLock {
      if cancelledEarly.remove(request.id) != nil { return nil }
      let task = session.dataTask(with: urlRequest)
      tasks[request.id] = task
      return task
    }
    guard let task else {
      promise.reject("ERR_CANCELED", "The download was cancelled")
      return
    }
    queue.addOperation {
      self.transfers[task.taskIdentifier] = transfer
      task.resume()
    }
  }

  func cancel(_ id: String) {
    let task: URLSessionDataTask? = lock.withLock {
      if let task = tasks[id] { return task }
      // Not started yet: `start` sees this. Bounded, should a cancel come after the end.
      if cancelledEarly.count > 256 { cancelledEarly.removeAll() }
      cancelledEarly.insert(id)
      return nil
    }
    task?.cancel()
  }

  private func progress(_ transfer: Transfer, force: Bool = false) {
    let now = Date()
    guard force || now.timeIntervalSince(transfer.lastReport) >= 0.1 else { return }
    transfer.lastReport = now
    report?([
      "id": transfer.id, "loaded": Double(transfer.loaded), "total": Double(transfer.total),
    ])
  }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard let transfer = transfers[dataTask.taskIdentifier] else {
      completionHandler(.cancel)
      return
    }
    let http = response as? HTTPURLResponse
    transfer.status = http?.statusCode ?? 200
    transfer.contentType = response.mimeType
    guard (200...299).contains(transfer.status) else {
      completionHandler(.cancel)
      return
    }
    // A Content-Encoding means the length counts compressed bytes, which the decoded
    // body won't add up to.
    let encoding = http?.value(forHTTPHeaderField: "Content-Encoding")
    transfer.total =
      encoding == nil || encoding == "identity" ? response.expectedContentLength : -1
    do {
      try transfer.open()
    } catch {
      transfer.failure = error
      completionHandler(.cancel)
      return
    }
    progress(transfer, force: true)
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard let transfer = transfers[dataTask.taskIdentifier], transfer.failure == nil else {
      return
    }
    do {
      try transfer.write(data)
      progress(transfer)
    } catch {
      transfer.failure = error
      dataTask.cancel()
    }
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?
  ) {
    guard let transfer = transfers.removeValue(forKey: task.taskIdentifier) else { return }
    lock.withLock { _ = tasks.removeValue(forKey: transfer.id) }
    transfer.close()
    let contentType: Any = transfer.contentType ?? NSNull()
    if transfer.status != 0, !(200...299).contains(transfer.status) {
      transfer.discard()
      transfer.promise.resolve(["status": transfer.status, "size": 0, "contentType": contentType])
      return
    }
    if let failure = transfer.failure ?? error {
      transfer.discard()
      if (failure as? URLError)?.code == .cancelled {
        transfer.promise.reject("ERR_CANCELED", "The download was cancelled")
      } else {
        transfer.promise.reject(failure)
      }
      return
    }
    do {
      try transfer.finish()
    } catch {
      transfer.discard()
      transfer.promise.reject(error)
      return
    }
    progress(transfer, force: true)
    transfer.promise.resolve([
      "status": transfer.status, "size": Double(transfer.loaded), "contentType": contentType,
    ])
  }
}
