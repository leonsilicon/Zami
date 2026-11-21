import Foundation
import UniformTypeIdentifiers
import WebKit

/// Zam's web app, bundled in the app as `zami-web/`, served to WKWebViews at
/// zami://localhost. A custom scheme is a secure context with its own storage (WebCrypto,
/// IndexedDB and localStorage work, as on https://), which a file:// URL isn't, and needs no
/// local server.
///
/// react-native-webview posts `RNCWebViewWillCreateWebView` with each web view's
/// configuration (patches/react-native-webview), and this registers itself as the scheme's
/// handler there. Paths that aren't files get index.html, as SvelteKit's static adapter
/// expects, and every HTML page loads `/__zami/start.js` (the shell's bootstrap) before its
/// own scripts.
final class ZamiWebApp: NSObject, WKURLSchemeHandler {
  static let shared = ZamiWebApp()
  static let scheme = "zami"
  static let host = "localhost"
  static let startScriptPath = "/__zami/start.js"
  private static let willCreateWebView = Notification.Name("RNCWebViewWillCreateWebView")
  private static let startScriptTag = "<script src=\"\(startScriptPath)\"></script>"

  /// The bundled app's directory, if the app has one.
  let root: URL? = {
    guard let url = Bundle.main.url(forResource: "zami-web", withExtension: nil) else { return nil }
    let index = url.appendingPathComponent("index.html")
    return FileManager.default.fileExists(atPath: index.path) ? url.standardizedFileURL : nil
  }()

  private let lock = NSLock()
  private var _startScript: String?
  var startScript: String? {
    get { lock.withLock { _startScript } }
    set { lock.withLock { _startScript = newValue } }
  }

  private var installed = false
  /// Tasks WebKit hasn't stopped yet (main thread only).
  private var running = Set<ObjectIdentifier>()
  private let queue = DispatchQueue(label: "com.leonsilicon.zami.shell.web-app", qos: .userInitiated, attributes: .concurrent)

  func install() {
    guard !installed else { return }
    installed = true
    NotificationCenter.default.addObserver(forName: Self.willCreateWebView, object: nil, queue: nil) { [weak self] note in
      guard let self, let configuration = note.object as? WKWebViewConfiguration else { return }
      if configuration.urlSchemeHandler(forURLScheme: Self.scheme) == nil {
        configuration.setURLSchemeHandler(self, forURLScheme: Self.scheme)
      }
    }
  }

  // MARK: WKURLSchemeHandler

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    let id = ObjectIdentifier(task)
    running.insert(id)
    let request = task.request
    queue.async {
      let response = self.respond(to: request)
      DispatchQueue.main.async {
        guard self.running.remove(id) != nil else { return }
        task.didReceive(response.head)
        task.didReceive(response.body)
        task.didFinish()
      }
    }
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
    running.remove(ObjectIdentifier(task))
  }

  // MARK: Responses

  private struct Response {
    let head: URLResponse
    let body: Data
  }

  private func respond(to request: URLRequest) -> Response {
    let url = request.url ?? URL(string: "\(Self.scheme)://\(Self.host)/")!
    let path = url.path.isEmpty ? "/" : url.path
    if path == Self.startScriptPath {
      return Self.response(url, status: 200, type: "text/javascript; charset=utf-8", body: Data((startScript ?? "").utf8))
    }
    guard let root, let file = resolve(path, in: root, accept: request.value(forHTTPHeaderField: "Accept")) else {
      return Self.response(url, status: 404, type: "text/plain; charset=utf-8", body: Data("Not found".utf8))
    }
    guard var data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
      return Self.response(url, status: 500, type: "text/plain; charset=utf-8", body: Data("Unreadable".utf8))
    }
    let type = Self.contentType(file)
    if type.hasPrefix("text/html"), startScript != nil, let html = String(data: data, encoding: .utf8) {
      data = Data(Self.withStartScript(html).utf8)
    }
    var headers = ["Cache-Control": path.hasPrefix("/_app/immutable/") ? "max-age=31536000, immutable" : "no-cache"]
    if let range = request.value(forHTTPHeaderField: "Range"), let (start, end) = Self.byteRange(range, size: data.count) {
      headers["Content-Range"] = "bytes \(start)-\(end)/\(data.count)"
      return Self.response(url, status: 206, type: type, body: data.subdata(in: start..<(end + 1)), headers: headers)
    }
    return Self.response(url, status: 200, type: type, body: data, headers: headers)
  }

  /// The file for `path`: the file itself, a directory's index.html, or (for a page, which
  /// asks for HTML) the app's index.html.
  private func resolve(_ path: String, in root: URL, accept: String?) -> URL? {
    let relative = path.drop(while: { $0 == "/" })
    let candidate = root.appendingPathComponent(String(relative)).standardizedFileURL
    guard candidate.path == root.path || candidate.path.hasPrefix(root.path + "/") else { return nil }
    var isDirectory: ObjCBool = false
    if FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory) {
      if !isDirectory.boolValue { return candidate }
      let index = candidate.appendingPathComponent("index.html")
      if FileManager.default.fileExists(atPath: index.path) { return index }
    }
    if accept?.contains("text/html") == true || relative.isEmpty {
      return root.appendingPathComponent("index.html")
    }
    return nil
  }

  static func withStartScript(_ html: String) -> String {
    if let head = html.range(of: "<head>", options: .caseInsensitive) {
      return html.replacingCharacters(in: head, with: html[head] + startScriptTag)
    }
    return startScriptTag + html
  }

  /// `bytes=start-end`, `bytes=start-` or `bytes=-suffix`, within `size`.
  static func byteRange(_ header: String, size: Int) -> (Int, Int)? {
    guard size > 0, header.hasPrefix("bytes="), !header.contains(",") else { return nil }
    let parts = header.dropFirst("bytes=".count).split(separator: "-", omittingEmptySubsequences: false)
    guard parts.count == 2 else { return nil }
    let first = Int(parts[0].trimmingCharacters(in: .whitespaces))
    let last = Int(parts[1].trimmingCharacters(in: .whitespaces))
    switch (first, last) {
    case let (start?, end?) where start <= end && start < size:
      return (start, min(end, size - 1))
    case let (start?, nil) where start < size:
      return (start, size - 1)
    case let (nil, suffix?) where suffix > 0:
      return (max(0, size - suffix), size - 1)
    default:
      return nil
    }
  }

  private static let contentTypes: [String: String] = [
    "html": "text/html; charset=utf-8",
    "js": "text/javascript; charset=utf-8",
    "mjs": "text/javascript; charset=utf-8",
    "css": "text/css; charset=utf-8",
    "json": "application/json",
    "webmanifest": "application/manifest+json",
    "wasm": "application/wasm",
    "svg": "image/svg+xml",
    "txt": "text/plain; charset=utf-8",
    "map": "application/json",
  ]

  static func contentType(_ file: URL) -> String {
    let ext = file.pathExtension.lowercased()
    if let type = contentTypes[ext] { return type }
    return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
  }

  private static func response(
    _ url: URL, status: Int, type: String, body: Data, headers: [String: String] = [:]
  ) -> Response {
    var fields = headers
    fields["Content-Type"] = type
    fields["Content-Length"] = String(body.count)
    fields["Accept-Ranges"] = "bytes"
    let head = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields)
      ?? URLResponse(url: url, mimeType: type, expectedContentLength: body.count, textEncodingName: nil)
    return Response(head: head, body: body)
  }
}
