package com.leonsilicon.zami.camera

import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.google.zxing.qrcode.encoder.Encoder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * decodeQrPixels on symbols ZXing's encoder draws: the version it reports, and data codewords
 * that hold the payload's exact bytes, as the JS side (qr-payload.ts) reads them.
 */
class ZamiQrTest {
  /** A symbol showing `payload` in byte mode, drawn `scale` pixels a module with a quiet zone. */
  private fun draw(payload: ByteArray, level: ErrorCorrectionLevel, scale: Int = 4): Triple<Int, IntArray, Int> {
    // ISO-8859-1 is ZXing's default for byte mode, so each char is one byte and no ECI
    // segment comes first.
    val code = Encoder.encode(String(payload, Charsets.ISO_8859_1), level)
    val matrix = code.matrix
    val quiet = 4
    val side = (matrix.width + quiet * 2) * scale
    val pixels = IntArray(side * side) { WHITE }
    for (y in 0 until side) {
      for (x in 0 until side) {
        val row = y / scale - quiet
        val col = x / scale - quiet
        if (row in 0 until matrix.height && col in 0 until matrix.width && matrix.get(col, row).toInt() == 1) {
          pixels[y * side + x] = BLACK
        }
      }
    }
    return Triple(side, pixels, code.version.versionNumber)
  }

  private class Bits(private val bytes: List<Int>) {
    private var at = 0

    fun read(count: Int): Int {
      var value = 0
      repeat(count) {
        value = (value shl 1) or ((bytes[at shr 3] shr (7 - (at and 7))) and 1)
        at++
      }
      return value
    }
  }

  private fun payloadOf(codewords: List<Int>, version: Int): ByteArray {
    val bits = Bits(codewords)
    assertEquals(0b0100, bits.read(4))
    val length = bits.read(if (version <= 9) 8 else 16)
    return ByteArray(length) { bits.read(8).toByte() }
  }

  @Test
  fun readsBinaryCodesCodewordsAndVersion() {
    val matrix = "MATRIX".toByteArray(Charsets.US_ASCII)
    for ((length, level) in listOf(120 to ErrorCorrectionLevel.M, 300 to ErrorCorrectionLevel.L)) {
      val payload = matrix + ByteArray(length) { ((it * 73 + 0xf1) and 0xff).toByte() }
      val (side, pixels, version) = draw(payload, level)
      val codes = decodeQrPixels(side, side, pixels)
      assertEquals(1, codes.size)
      assertEquals(version, codes[0]["version"])
      @Suppress("UNCHECKED_CAST")
      val codewords = codes[0]["codewords"] as List<Int>
      assertTrue(codewords.all { it in 0..255 })
      assertEquals(payload.toList(), payloadOf(codewords, version).toList())
    }
  }

  @Test
  fun findsNothingWithoutACode() {
    val side = 200
    val pixels = IntArray(side * side) { if ((it / 7) % 3 == 0) BLACK else WHITE }
    assertEquals(emptyList<Map<String, Any>>(), decodeQrPixels(side, side, pixels))
  }

  private companion object {
    const val WHITE = 0xffffffff.toInt()
    const val BLACK = 0xff000000.toInt()
  }
}
