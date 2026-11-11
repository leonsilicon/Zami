package com.leonsilicon.zami.media

import android.content.Context
import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.security.MessageDigest
import java.security.SecureRandom
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Zami's attachments off the JS thread (@-/com.leonsilicon.zami.media): file I/O, AES-CTR
 * and SHA-256 file to file, downloads streamed into files (verified and decrypted on the
 * way), and thumbnails. Nothing large crosses into JS: files go in and out as URIs. The JS
 * side checks arguments first.
 */
class ZamiMediaModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val downloads = Downloads { body -> sendEvent("onProgress", body) }
  private val random = SecureRandom()

  override fun definition() = ModuleDefinition {
    Name("ZamiMedia")

    Events("onProgress")

    // The app's cache directory, as a `file://` URI ending in `/`.
    Function("cacheDirectory") { Uri.fromFile(context.cacheDir).toString().trimEnd('/') + "/" }

    // Small, synchronous file system calls: a stat and a mkdir.
    Function("exists") { uri: String ->
      try {
        fileOf(uri).exists()
      } catch (_: Exception) {
        false
      }
    }

    Function("makeDirectory") { uri: String ->
      val directory = fileOf(uri)
      if (!directory.isDirectory && !directory.mkdirs()) throw IOException("Can't create $uri")
    }

    AsyncFunction("list") Coroutine { uri: String ->
      withContext(Dispatchers.IO) {
        try {
          fileOf(uri).list()?.toList() ?: emptyList()
        } catch (_: Exception) {
          emptyList()
        }
      }
    }

    AsyncFunction("move") Coroutine { from: String, to: String ->
      withContext(Dispatchers.IO) {
        val source = fileOf(from)
        val destination = fileOf(to)
        if (destination.exists()) destination.delete()
        if (!source.renameTo(destination)) {
          source.copyTo(destination, overwrite = true)
          source.delete()
        }
      }
    }

    AsyncFunction("readRange") Coroutine { uri: String, offset: Double, length: Int ->
      withContext(Dispatchers.IO) {
        openAt(context, uri, offset.toLong().coerceAtLeast(0)).use {
          readUpTo(it, length.coerceAtLeast(0))
        }
      }
    }

    AsyncFunction("writeFile") Coroutine { uri: String, data: ByteArray ->
      withContext(Dispatchers.IO) {
        createForWriting(fileOf(uri)).use { it.write(data) }
      }
    }

    AsyncFunction("concat") Coroutine { ranges: List<FileRange>, dest: String ->
      withContext(Dispatchers.IO) {
        transform(context, ranges, fileOf(dest)) { chunk, length, write ->
          write(chunk.copyOf(length))
        }.toDouble()
      }
    }

    // A fresh 256-bit key and an IV of 8 random bytes then 8 zero bytes, as Matrix's
    // EncryptedFile v2 has it; the SHA-256 is of the ciphertext.
    AsyncFunction("encrypt") Coroutine { ranges: List<FileRange>, dest: String ->
      withContext(Dispatchers.IO) {
        val key = ByteArray(32).also(random::nextBytes)
        val iv = ByteArray(16).also { random.nextBytes(it); it.fill(0, 8, 16) }
        val cipher = AesCtr(key, iv)
        val digest = MessageDigest.getInstance("SHA-256")
        val size = transform(context, ranges, fileOf(dest)) { chunk, length, write ->
          val out = cipher.update(chunk, 0, length)
          digest.update(out)
          write(out)
        }
        mapOf(
          "key" to Base64.encodeToString(key, Base64.NO_WRAP),
          "iv" to Base64.encodeToString(iv, Base64.NO_WRAP),
          "sha256" to Base64.encodeToString(digest.digest(), Base64.NO_WRAP),
          "size" to size.toDouble(),
        )
      }
    }

    // Zam's JPEG metadata stripping, byte for byte (JpegStrip): "stripped" with the result
    // in `dest`, "unchanged" for a JPEG it leaves as it is, "notJpeg" for anything else.
    AsyncFunction("stripJpeg") Coroutine { src: String, dest: String ->
      withContext(Dispatchers.IO) {
        val bytes = openAt(context, src, 0).use { it.readBytes() }
        if (bytes.size < 2 || bytes[0] != 0xff.toByte() || bytes[1] != 0xd8.toByte()) {
          "notJpeg"
        } else {
          val stripped = JpegStrip.strip(bytes)
          if (stripped == null) {
            "unchanged"
          } else {
            createForWriting(fileOf(dest)).use { it.write(stripped) }
            "stripped"
          }
        }
      }
    }

    AsyncFunction("download") Coroutine { request: DownloadRequest ->
      withContext(Dispatchers.IO) { downloads.run(request) }
    }

    Function("cancel") { id: String -> downloads.cancel(id) }

    AsyncFunction("videoThumbnail") Coroutine { uri: String, dest: String, maxEdge: Double, quality: Double ->
      withContext(Dispatchers.IO) { videoThumbnail(context, uri, dest, maxEdge, quality) }
    }

    AsyncFunction("imageThumbnail") Coroutine { uri: String, dest: String, maxEdge: Double, quality: Double ->
      withContext(Dispatchers.IO) { imageThumbnail(context, uri, dest, maxEdge, quality) }
    }

    AsyncFunction("prune") Coroutine { directory: String, maxBytes: Double ->
      withContext(Dispatchers.IO) { prune(fileOf(directory), maxBytes.toLong()) }
    }

    AsyncFunction("remove") Coroutine { uris: List<String> ->
      withContext(Dispatchers.IO) {
        for (uri in uris) {
          try {
            fileOf(uri).deleteRecursively()
          } catch (_: Exception) {
          }
        }
      }
    }
  }
}
