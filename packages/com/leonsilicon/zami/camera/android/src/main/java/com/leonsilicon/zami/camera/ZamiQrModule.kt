package com.leonsilicon.zami.camera

import android.graphics.BitmapFactory
import android.net.Uri
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.ResultMetadataType
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.google.zxing.qrcode.decoder.Version
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The QR codes in an image file, read with ZXing, for Zami's QR scanner
 * (@-/com.leonsilicon.zami.camera). Matrix codes are binary, and a scanner's text can't carry
 * arbitrary bytes, so this gives each code's error-corrected data codewords and its version,
 * as the iOS module does (ios/ZamiQrModule.swift), and the JS side parses them into the
 * payload's exact bytes. It runs off the JS thread.
 */
class ZamiQrModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZamiQr")

    AsyncFunction("decodeQrCodes") Coroutine { uri: String ->
      withContext(Dispatchers.Default) { decodeQrCodes(uri) }
    }
  }
}

/** The longest side decoded: a scanner frame is 640 wide; a bigger still is scaled down. */
private const val MAX_SIDE = 1600

private val HINTS =
  mapOf(
    DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
    DecodeHintType.TRY_HARDER to true,
  )

private class QrImageUnreadableException(uri: String) :
  CodedException("Couldn't read the image at $uri")

private fun decodeQrCodes(uri: String): List<Map<String, Any>> {
  val path = Uri.parse(uri).path ?: uri
  val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
  BitmapFactory.decodeFile(path, bounds)
  var sample = 1
  while (maxOf(bounds.outWidth, bounds.outHeight) / sample > MAX_SIDE) sample *= 2
  val bitmap =
    BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
      ?: throw QrImageUnreadableException(uri)
  val width = bitmap.width
  val height = bitmap.height
  val pixels = IntArray(width * height)
  bitmap.getPixels(pixels, 0, width, 0, 0, width, height)
  bitmap.recycle()
  return decodeQrPixels(width, height, pixels)
}

/** The QR codes in an image's ARGB pixels, row by row: each one's version and codewords. */
internal fun decodeQrPixels(width: Int, height: Int, pixels: IntArray): List<Map<String, Any>> {
  val result =
    try {
      QRCodeReader().decode(BinaryBitmap(HybridBinarizer(RGBLuminanceSource(width, height, pixels))), HINTS)
    } catch (_: ReaderException) {
      return emptyList()
    }
  val codewords = result.rawBytes ?: return emptyList()
  val level = result.resultMetadata?.get(ResultMetadataType.ERROR_CORRECTION_LEVEL) as? String
    ?: return emptyList()
  val ecLevel = ErrorCorrectionLevel.valueOf(level)
  // ZXing's result doesn't name the version, but its codewords are the version's data
  // codewords at this error correction level, which grow with each version.
  val version =
    (1..40).firstOrNull { number ->
      val candidate = Version.getVersionForNumber(number)
      candidate.totalCodewords - candidate.getECBlocksForLevel(ecLevel).totalECCodewords ==
        codewords.size
    } ?: return emptyList()
  return listOf(mapOf("version" to version, "codewords" to codewords.map { it.toInt() and 0xff }))
}
