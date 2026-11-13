package com.leonsilicon.zami.webcrypto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * The module's computations on the JVM's providers, against known answers from Node's
 * crypto (and the RFCs' vectors where they have one), which the JS side's @noble path and
 * Node's WebCrypto give too.
 */
class ZamiWebCryptoTest {
  private fun hex(bytes: ByteArray) = bytes.joinToString("") { "%02x".format(it) }

  private fun utf8(text: String) = text.toByteArray(Charsets.UTF_8)

  /** Bytes (i * k + 7) mod 256, as the vector script makes them. */
  private fun seq(length: Int, k: Int = 1) = ByteArray(length) { ((it * k + 7) and 0xff).toByte() }

  private fun unhex(text: String) = ByteArray(text.length / 2) { text.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

  @Test
  fun digests() {
    assertEquals(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      hex(digest(Hash.of("SHA-256"), utf8("abc"))),
    )
    assertEquals(
      "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a" +
        "2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
      hex(digest(Hash.of("SHA-512"), utf8("abc"))),
    )
  }

  @Test
  fun hmacs() {
    val data = utf8("what do ya want for nothing?")
    // RFC 4231, test case 2.
    assertEquals(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
      hex(hmac(Hash.SHA256, utf8("Jefe")).doFinal(data)),
    )
    assertEquals(
      "164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea250554" +
        "9758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737",
      hex(hmac(Hash.SHA512, utf8("Jefe")).doFinal(data)),
    )
    // An empty key, which Java's SecretKeySpec refuses.
    assertEquals(
      "b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad",
      hex(hmac(Hash.SHA256, ByteArray(0)).doFinal(ByteArray(0))),
    )
  }

  @Test
  fun pbkdf2() {
    // RFC 7914, section 11.
    assertEquals(
      "55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc" +
        "49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783",
      hex(pbkdf2(Hash.SHA256, utf8("passwd"), utf8("salt"), 1, 64)),
    )
    // Two SHA-512 blocks, the second cut short.
    assertEquals(
      "d197b1b33db0143e018b12f3d1d1479e6cdebdcc97c5c0f87f6902e072f457b5" +
        "143f30602641b3d55cd335988cb36b84376060ecd532e039b742a239434af2d5" +
        "d6883f0be4c24d363b638f4c2f8d917533cd4158937d0b490697a64adadb07f1" +
        "80c32308",
      hex(pbkdf2(Hash.SHA512, utf8("password"), utf8("salt"), 4096, 100)),
    )
    // An empty password, and one that isn't text (what Java's own PBKDF2 can't take).
    assertEquals(
      "5ddf839afa2d5fb4be56e1a0f48917617559bef61ec122bfca1c7f75ac8f401d",
      hex(pbkdf2(Hash.SHA256, ByteArray(0), utf8("salt"), 3, 32)),
    )
    assertEquals(
      "346ec8de07bd80771753f702628389dfac22232be2cdf098c34dba26a81f13b3" +
        "2a8f3cbe25b1466b7fb3232c06fb57fc506fedd2f12ec161908ce7562202b1e4" +
        "b6",
      hex(pbkdf2(Hash.SHA256, byteArrayOf(-1, 0, -61, 40, -128), seq(16), 1000, 65)),
    )
  }

  @Test
  fun aesCtrCountsOverTheWholeBlock() {
    // The counter carries out of its low 64 bits, as noble's and CommonCrypto's do.
    assertEquals(
      "0a1944f44783fa8ba1acdeb244d8496bea1915650a8aa93b23caa22a46d4e2fe" +
        "d6658aef3e01061de08da00efd5b2f8a4906fe49ea2e3e6e566312e8691b5c4f" +
        "f58e7ac1a4d1ef38e5653ed472c83836",
      hex(aesCtr(seq(32, 3), unhex("fffffffffffffffffffffffffffffffe"), seq(80, 5))),
    )
  }

  @Test
  fun aesGcmSealsAndOpens() {
    val expected =
      mapOf(
        16 to "2d2573182c7226224d17ece2d39a584e3e870e7540ed39805812d719e8ca3b3f",
        24 to "57741a25d0d328cf3480084bed6e076abe8f02e6aa8f96eb27bfd7ba6694f9f7",
        32 to "0a2237a733e7d36d5f8b1c8580a1cd40d2ffdbdfdb2e4c938dbb02b759e05173",
      )
    for ((keyLength, sealedHash) in expected) {
      val key = seq(keyLength, 11)
      val iv = seq(12, 13)
      val aad = seq(20, 17)
      val plain = seq(1000, 19)
      val sealed = aesGcm(true, key, iv, aad, plain)!!
      assertEquals(1016, sealed.size)
      assertEquals(sealedHash, hex(digest(Hash.SHA256, sealed)))
      assertEquals(hex(plain), hex(aesGcm(false, key, iv, aad, sealed)!!))
      val tampered = sealed.copyOf().also { it[3] = (it[3].toInt() xor 1).toByte() }
      assertNull(aesGcm(false, key, iv, aad, tampered))
      assertNull(aesGcm(false, key, iv, ByteArray(0), sealed))
    }
    // No additional data, and nothing to seal: just the tag.
    val tag = aesGcm(true, seq(32), seq(12), ByteArray(0), ByteArray(0))!!
    assertEquals(16, tag.size)
    assertEquals(0, aesGcm(false, seq(32), seq(12), ByteArray(0), tag)!!.size)
  }
}
