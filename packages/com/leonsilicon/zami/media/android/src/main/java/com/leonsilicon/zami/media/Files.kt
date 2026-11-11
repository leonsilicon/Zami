package com.leonsilicon.zami.media

import android.content.Context
import android.net.Uri
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream

/** What native code reads a file in. */
const val CHUNK_BYTES = 1 shl 20

/** A range of a file, as the JS side passes it. */
class FileRange : Record {
  @Field val uri: String = ""
  @Field val offset: Double = 0.0
  @Field val length: Double = 0.0
}

/** The file of a `file://` URI (or a plain path). */
fun fileOf(uri: String): File {
  if (uri.startsWith("file:")) {
    val path = Uri.parse(uri).path ?: throw IOException("Not a file URI: $uri")
    return File(path)
  }
  if (uri.startsWith("/")) return File(uri)
  throw IOException("Not a file URI: $uri")
}

/** `uri` opened at `offset`: a file, or a `content://` document. */
fun openAt(context: Context, uri: String, offset: Long): InputStream {
  if (uri.startsWith("content://")) {
    val input = context.contentResolver.openInputStream(Uri.parse(uri))
      ?: throw IOException("Can't open $uri")
    var left = offset
    while (left > 0) {
      val skipped = input.skip(left)
      if (skipped <= 0) {
        if (input.read() < 0) {
          input.close()
          throw IOException("$uri is shorter than expected")
        }
        left -= 1
      } else {
        left -= skipped
      }
    }
    return input
  }
  val input = FileInputStream(fileOf(uri))
  input.channel.position(offset)
  return input
}

/** Up to `length` bytes from `input`, fewer only at its end. */
fun readUpTo(input: InputStream, length: Int): ByteArray {
  val out = ByteArray(length)
  var at = 0
  while (at < length) {
    val read = input.read(out, at, length - at)
    if (read < 0) break
    at += read
  }
  return if (at == length) out else out.copyOf(at)
}

/** A new, empty file at `file`, open for writing. */
fun createForWriting(file: File): FileOutputStream {
  file.parentFile?.mkdirs()
  return FileOutputStream(file, false)
}

/**
 * Reads `ranges` a chunk at a time, hands each to `body` with a writer of `dest`, and
 * returns how many bytes were written.
 */
fun transform(
  context: Context,
  ranges: List<FileRange>,
  dest: File,
  body: (chunk: ByteArray, length: Int, write: (ByteArray) -> Unit) -> Unit,
): Long {
  var written = 0L
  createForWriting(dest).use { out ->
    val write = { data: ByteArray ->
      out.write(data)
      written += data.size
    }
    val buffer = ByteArray(CHUNK_BYTES)
    for (range in ranges) {
      if (range.offset < 0 || range.length < 0) throw IOException("Bad range of ${range.uri}")
      openAt(context, range.uri, range.offset.toLong()).use { input ->
        var left = range.length.toLong()
        while (left > 0) {
          val read = input.read(buffer, 0, minOf(left, CHUNK_BYTES.toLong()).toInt())
          if (read < 0) throw IOException("${range.uri} is shorter than expected")
          if (read == 0) continue
          body(buffer, read, write)
          left -= read
        }
      }
    }
  }
  return written
}

/**
 * Deletes `.part` files left by downloads an hour old or more, and the files modified
 * longest ago until the rest fit in `maxBytes`. Returns the names of the files left.
 */
fun prune(directory: File, maxBytes: Long): List<String> {
  val entries = directory.listFiles() ?: return emptyList()
  val stale = System.currentTimeMillis() - 3_600_000
  val files = mutableListOf<File>()
  for (entry in entries) {
    if (!entry.isFile) continue
    if (entry.extension == "part") {
      // A download in progress keeps writing its .part file.
      if (entry.lastModified() < stale) entry.delete()
      continue
    }
    files.add(entry)
  }
  files.sortBy { it.lastModified() }
  var total = files.sumOf { it.length() }
  var first = 0
  while (total > maxBytes && first < files.size) {
    total -= files[first].length()
    files[first].delete()
    first++
  }
  return files.drop(first).map { it.name }
}
