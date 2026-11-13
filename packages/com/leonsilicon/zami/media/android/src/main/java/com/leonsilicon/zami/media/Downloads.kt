package com.leonsilicon.zami.media

import android.util.Base64
import com.facebook.react.modules.network.OkHttpClientProvider
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request

/** A download as the JS side asks for it. */
class DownloadRequest : Record {
  @Field val id: String = ""
  @Field val url: String = ""
  @Field val headers: Map<String, String> = emptyMap()
  @Field val dest: String = ""
  @Field val key: String? = null
  @Field val iv: String? = null
  @Field val sha256: String? = null
}

class DownloadCancelledException :
  CodedException("ERR_CANCELED", "The download was cancelled", null)

class DownloadFailedException(message: String, cause: Throwable?) :
  CodedException("ERR_DOWNLOAD", message, cause)

/**
 * Downloads into files, off the JS thread: the response streams into `<dest>.part`
 * (decrypted, if it is an encrypted attachment, with the SHA-256 of the ciphertext taken
 * on the way), which becomes `dest` only once complete and, for an attachment, verified.
 * Progress is reported at most every 100 ms.
 */
class Downloads(private val report: (Map<String, Any>) -> Unit) {
  private val client: OkHttpClient by lazy {
    OkHttpClientProvider.createClientBuilder()
      .connectTimeout(60, TimeUnit.SECONDS)
      .readTimeout(60, TimeUnit.SECONDS)
      .build()
  }
  private val calls = HashMap<String, Call>()
  /** Ids cancelled before their download had started (`run` runs on another thread). */
  private val cancelledEarly = HashSet<String>()

  fun cancel(id: String) {
    val call: Call? =
      synchronized(this) {
        val started = calls[id]
        if (started == null) {
          // Not started yet: `run` sees this. Bounded, should a cancel come after the end.
          if (cancelledEarly.size > 256) cancelledEarly.clear()
          cancelledEarly.add(id)
        }
        started
      }
    call?.cancel()
  }

  /** Runs the download on the calling (background) thread. */
  fun run(request: DownloadRequest): Map<String, Any?> {
    val dest = fileOf(request.dest)
    val part = File(dest.path + ".part")
    val (cipher, expectedHash) = cipherOf(request)
    val builder = Request.Builder().url(request.url)
    for ((name, value) in request.headers) builder.header(name, value)
    // Made and registered under the lock, so a cancel lands either before (and is seen
    // here) or after (and finds the call).
    val call =
      synchronized(this) {
        if (cancelledEarly.remove(request.id)) throw DownloadCancelledException()
        client.newCall(builder.build()).also { calls[request.id] = it }
      }
    try {
      call.execute().use { response ->
        val status = response.code
        val contentType = response.header("Content-Type")?.substringBefore(";")?.trim()
        if (status !in 200..299) {
          return mapOf("status" to status, "size" to 0.0, "contentType" to contentType)
        }
        val body = response.body ?: throw IOException("No response body")
        // A Content-Encoding means the length counts compressed bytes, which the decoded
        // body won't add up to.
        val encoding = response.header("Content-Encoding")
        val total = if (encoding == null || encoding == "identity") body.contentLength() else -1L
        val digest = MessageDigest.getInstance("SHA-256")
        var loaded = 0L
        var lastReport = 0L
        fun progress(force: Boolean) {
          val now = System.currentTimeMillis()
          if (!force && now - lastReport < 100) return
          lastReport = now
          report(mapOf("id" to request.id, "loaded" to loaded.toDouble(), "total" to total.toDouble()))
        }
        progress(true)
        createForWriting(part).use { out ->
          body.byteStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
              val read = input.read(buffer)
              if (read < 0) break
              if (read == 0) continue
              if (cipher != null) {
                digest.update(buffer, 0, read)
                out.write(cipher.update(buffer, 0, read))
              } else {
                out.write(buffer, 0, read)
              }
              loaded += read
              progress(false)
            }
          }
        }
        if (expectedHash != null && !MessageDigest.isEqual(digest.digest(), expectedHash)) {
          throw IOException("Attachment integrity check failed (hash mismatch)")
        }
        if (dest.exists()) dest.delete()
        if (!part.renameTo(dest)) throw IOException("Can't move the download into place")
        progress(true)
        return mapOf("status" to status, "size" to loaded.toDouble(), "contentType" to contentType)
      }
    } catch (error: Exception) {
      part.delete()
      if (call.isCanceled()) throw DownloadCancelledException()
      throw DownloadFailedException(error.message ?: "The download failed", error)
    } finally {
      synchronized(this) { calls.remove(request.id) }
    }
  }

  private fun cipherOf(request: DownloadRequest): Pair<AesCtr?, ByteArray?> {
    val key = request.key ?: return Pair(null, null)
    val iv = request.iv ?: return Pair(null, null)
    val sha256 = request.sha256 ?: return Pair(null, null)
    val hash = Base64.decode(sha256, Base64.DEFAULT)
    if (hash.size != 32) throw IOException("Bad attachment hash")
    return Pair(AesCtr(Base64.decode(key, Base64.DEFAULT), Base64.decode(iv, Base64.DEFAULT)), hash)
  }
}
