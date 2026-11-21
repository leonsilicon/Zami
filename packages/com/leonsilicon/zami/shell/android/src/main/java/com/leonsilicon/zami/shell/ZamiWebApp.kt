package com.leonsilicon.zami.shell

import android.content.Context
import android.content.res.AssetManager
import android.webkit.MimeTypeMap
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import com.reactnativecommunity.webview.RNCWebViewClient
import java.io.ByteArrayInputStream
import java.io.FileNotFoundException
import java.io.InputStream

/**
 * Zam's web app, bundled in the app's assets as `zami-web/`, served at https://localhost:
 * the origin Zam's own Android app (Capacitor) uses, a secure context with its own storage.
 *
 * react-native-webview's WebViewClient asks [RNCWebViewClient.requestInterceptor] about each
 * request before the network (patches/react-native-webview); this answers the ones for that
 * origin. Paths that aren't files get index.html, as SvelteKit's static adapter expects, and
 * every HTML page loads `/__zami/start.js` (the shell's bootstrap) before its own scripts.
 */
object ZamiWebApp : RNCWebViewClient.RequestInterceptor {
  const val ORIGIN = "https://localhost"
  private const val HOST = "localhost"
  private const val ROOT = "zami-web"
  private const val START_SCRIPT_PATH = "/__zami/start.js"
  private const val START_SCRIPT_TAG = "<script src=\"$START_SCRIPT_PATH\"></script>"

  private val TYPES = mapOf(
    "html" to "text/html",
    "js" to "text/javascript",
    "mjs" to "text/javascript",
    "css" to "text/css",
    "json" to "application/json",
    "webmanifest" to "application/manifest+json",
    "wasm" to "application/wasm",
    "svg" to "image/svg+xml",
    "txt" to "text/plain",
    "map" to "application/json",
  )

  @Volatile var startScript: String? = null
  @Volatile private var assets: AssetManager? = null

  fun install(context: Context) {
    if (assets != null) return
    assets = context.assets
    RNCWebViewClient.requestInterceptor = this
  }

  fun available(): Boolean = exists("$ROOT/index.html")

  override fun intercept(view: WebView, request: WebResourceRequest): WebResourceResponse? {
    val url = request.url
    if (url.scheme != "https" || url.host != HOST) return null
    val path = url.path?.takeIf { it.isNotEmpty() } ?: "/"
    if (path == START_SCRIPT_PATH) {
      return response("text/javascript", (startScript ?: "").toByteArray().inputStream())
    }
    val file = resolve(path, request) ?: return response("text/plain", "Not found".byteInputStream(), 404, "Not Found")
    val type = contentType(file)
    val stream = open(file) ?: return response("text/plain", "Not found".byteInputStream(), 404, "Not Found")
    if (type == "text/html" && startScript != null) {
      val html = stream.use { it.readBytes().toString(Charsets.UTF_8) }
      return response(type, ByteArrayInputStream(withStartScript(html).toByteArray()))
    }
    return response(type, stream)
  }

  /** The asset for [path]: the file itself, a directory's index.html, or (for a page) index.html. */
  private fun resolve(path: String, request: WebResourceRequest): String? {
    val relative = path.trimStart('/')
    if (relative.split('/').any { it == ".." }) return null
    val candidate = if (relative.isEmpty()) "$ROOT/index.html" else "$ROOT/$relative"
    if (exists(candidate)) return candidate
    val index = "${candidate.trimEnd('/')}/index.html"
    if (exists(index)) return index
    val accept = request.requestHeaders["Accept"] ?: request.requestHeaders["accept"]
    if (request.isForMainFrame || accept?.contains("text/html") == true) return "$ROOT/index.html"
    return null
  }

  private fun exists(path: String): Boolean =
    try {
      assets?.open(path)?.close()
      assets != null
    } catch (_: FileNotFoundException) {
      false
    } catch (_: java.io.IOException) {
      false
    }

  private fun open(path: String): InputStream? =
    try {
      assets?.open(path, AssetManager.ACCESS_STREAMING)
    } catch (_: java.io.IOException) {
      null
    }

  private fun contentType(path: String): String {
    val ext = path.substringAfterLast('.', "").lowercase()
    return TYPES[ext] ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"
  }

  fun withStartScript(html: String): String {
    val head = Regex("<head>", RegexOption.IGNORE_CASE).find(html) ?: return START_SCRIPT_TAG + html
    return html.substring(0, head.range.last + 1) + START_SCRIPT_TAG + html.substring(head.range.last + 1)
  }

  private fun response(type: String, body: InputStream, status: Int = 200, reason: String = "OK"): WebResourceResponse {
    val textual = type.startsWith("text/") || type == "application/json" || type == "application/manifest+json"
    return WebResourceResponse(
      type,
      if (textual) "utf-8" else null,
      status,
      reason,
      mapOf("Cache-Control" to "no-cache", "Access-Control-Allow-Origin" to ORIGIN),
      body,
    )
  }
}
