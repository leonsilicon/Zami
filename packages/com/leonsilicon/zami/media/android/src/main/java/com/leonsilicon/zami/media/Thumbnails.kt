package com.leonsilicon.zami.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.media.ExifInterface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import java.io.IOException
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** `bitmap` fitted in `maxEdge` (never enlarged). */
private fun fit(bitmap: Bitmap, maxEdge: Double): Bitmap {
  val longest = max(bitmap.width, bitmap.height)
  if (longest <= maxEdge) return bitmap
  val scale = maxEdge / longest
  val width = max(1, (bitmap.width * scale).roundToInt())
  val height = max(1, (bitmap.height * scale).roundToInt())
  return Bitmap.createScaledBitmap(bitmap, width, height, true)
}

/** `bitmap` turned by `degrees` clockwise. */
private fun turn(bitmap: Bitmap, degrees: Int, mirror: Boolean = false): Bitmap {
  if (degrees == 0 && !mirror) return bitmap
  val matrix = Matrix()
  if (mirror) matrix.postScale(-1f, 1f)
  matrix.postRotate(degrees.toFloat())
  return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
}

/**
 * Writes `bitmap` to `dest` as a JPEG (over white: JPEG has no alpha, and transparent
 * pixels would come out black), and describes it for the JS side.
 */
private fun writeJpeg(
  bitmap: Bitmap,
  dest: String,
  quality: Double,
  width: Int,
  height: Int,
): Map<String, Any> {
  val file = fileOf(dest)
  var opaque = bitmap
  if (bitmap.hasAlpha()) {
    opaque = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(opaque)
    canvas.drawColor(Color.WHITE)
    canvas.drawBitmap(bitmap, 0f, 0f, null)
  }
  createForWriting(file).use { out ->
    if (!opaque.compress(Bitmap.CompressFormat.JPEG, (quality * 100).roundToInt(), out)) {
      throw IOException("Can't encode a JPEG")
    }
  }
  return mapOf(
    "width" to width,
    "height" to height,
    "thumbWidth" to opaque.width,
    "thumbHeight" to opaque.height,
    "size" to file.length().toDouble(),
  )
}

/**
 * A frame about a tenth of the way into the video at `uri` (at most 1 s in, past the black
 * frames videos start with), upright and fitted in `maxEdge`.
 */
fun videoThumbnail(
  context: Context,
  uri: String,
  dest: String,
  maxEdge: Double,
  quality: Double,
): Map<String, Any> {
  val retriever = MediaMetadataRetriever()
  try {
    if (uri.startsWith("content://")) retriever.setDataSource(context, Uri.parse(uri))
    else retriever.setDataSource(fileOf(uri).path)
    fun number(key: Int) = retriever.extractMetadata(key)?.toLongOrNull() ?: 0L
    val durationMs = number(MediaMetadataRetriever.METADATA_KEY_DURATION)
    val rotation = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION).toInt()
    val quarter = rotation == 90 || rotation == 270
    var width = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH).toInt()
    var height = number(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT).toInt()
    if (quarter) width = height.also { height = width }
    val timeUs = min(1_000_000L, max(0L, durationMs * 100L))
    val edge = maxEdge.roundToInt()
    val frame =
      (if (Build.VERSION.SDK_INT >= 27) {
        retriever.getScaledFrameAtTime(
          timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, edge, edge)
      } else {
        retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
      }) ?: throw IOException("No video frame")
    // Frames come out upright on current Android; turn one that didn't.
    val upright =
      if (quarter && width > 0 && height > 0 && (frame.width > frame.height) != (width > height))
        turn(frame, rotation)
      else frame
    if (width <= 0 || height <= 0) {
      width = upright.width
      height = upright.height
    }
    return writeJpeg(fit(upright, maxEdge), dest, quality, width, height)
  } finally {
    try {
      retriever.release()
    } catch (_: Exception) {
    }
  }
}

/**
 * The image at `uri`, upright (its Exif orientation applied) and fitted in `maxEdge`,
 * decoded at about that size rather than in full.
 */
fun imageThumbnail(
  context: Context,
  uri: String,
  dest: String,
  maxEdge: Double,
  quality: Double,
): Map<String, Any> {
  val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  openAt(context, uri, 0).use { BitmapFactory.decodeStream(it, null, bounds) }
  if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IOException("Can't read the image")
  val orientation =
    try {
      openAt(context, uri, 0).use {
        ExifInterface(it).getAttributeInt(
          ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
      }
    } catch (_: Exception) {
      ExifInterface.ORIENTATION_NORMAL
    }
  var sample = 1
  while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxEdge) sample *= 2
  val decoded =
    openAt(context, uri, 0).use {
      BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: throw IOException("Can't decode the image")
  val upright =
    when (orientation) {
      ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> turn(decoded, 0, mirror = true)
      ExifInterface.ORIENTATION_ROTATE_180 -> turn(decoded, 180)
      ExifInterface.ORIENTATION_FLIP_VERTICAL -> turn(decoded, 180, mirror = true)
      ExifInterface.ORIENTATION_TRANSPOSE -> turn(decoded, 90, mirror = true)
      ExifInterface.ORIENTATION_ROTATE_90 -> turn(decoded, 90)
      ExifInterface.ORIENTATION_TRANSVERSE -> turn(decoded, 270, mirror = true)
      ExifInterface.ORIENTATION_ROTATE_270 -> turn(decoded, 270)
      else -> decoded
    }
  val quarter =
    orientation == ExifInterface.ORIENTATION_TRANSPOSE ||
      orientation == ExifInterface.ORIENTATION_ROTATE_90 ||
      orientation == ExifInterface.ORIENTATION_TRANSVERSE ||
      orientation == ExifInterface.ORIENTATION_ROTATE_270
  val width = if (quarter) bounds.outHeight else bounds.outWidth
  val height = if (quarter) bounds.outWidth else bounds.outHeight
  return writeJpeg(fit(upright, maxEdge), dest, quality, width, height)
}
