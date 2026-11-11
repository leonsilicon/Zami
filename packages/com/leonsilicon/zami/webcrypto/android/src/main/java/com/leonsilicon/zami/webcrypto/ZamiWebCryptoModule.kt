package com.leonsilicon.zami.webcrypto

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The costly part of Zami's `crypto.subtle` (@-/com.leonsilicon.zami.webcrypto), in the
 * platform's providers (javax.crypto, Conscrypt) and off the JS thread: digests, HMAC,
 * AES-CTR and AES-GCM over whole attachments, key files and file-transfer blocks, and
 * PBKDF2's hundreds of thousands of iterations. The same functions as the iOS module
 * (ios/ZamiWebCryptoModule.swift). The JS side checks every argument first, so these only
 * compute.
 *
 * Each runs on Dispatchers.Default rather than Expo's one shared async-function thread, so a
 * long job holds up neither the other modules' async functions nor another crypto call.
 */
class ZamiWebCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZamiWebCrypto")

    AsyncFunction("digest") Coroutine { hash: String, data: ByteArray ->
      compute { digest(Hash.of(hash), data) }
    }

    AsyncFunction("hmac") Coroutine { hash: String, key: ByteArray, data: ByteArray ->
      compute { hmac(Hash.of(hash), key).doFinal(data) }
    }

    AsyncFunction("aesCtr") Coroutine { key: ByteArray, counter: ByteArray, data: ByteArray ->
      compute { aesCtr(key, counter, data) }
    }

    AsyncFunction("aesGcm") Coroutine {
      encrypt: Boolean, key: ByteArray, iv: ByteArray, additionalData: ByteArray, data: ByteArray ->
      compute { aesGcm(encrypt, key, iv, additionalData, data) }
    }

    AsyncFunction("pbkdf2") Coroutine {
      hash: String, password: ByteArray, salt: ByteArray, iterations: Int, length: Int ->
      if (iterations <= 0 || length <= 0) throw CryptoFailedException("PBKDF2 arguments")
      compute { pbkdf2(Hash.of(hash), password, salt, iterations, length) }
    }
  }
}

private const val GCM_TAG_BITS = 128

/** The hashes the JS side passes, by their WebCrypto names. */
internal enum class Hash(val digest: String, val mac: String) {
  SHA256("SHA-256", "HmacSHA256"),
  SHA512("SHA-512", "HmacSHA512");

  companion object {
    fun of(name: String): Hash =
      when (name) {
        "SHA-256" -> SHA256
        "SHA-512" -> SHA512
        else -> throw CryptoFailedException("hash $name")
      }
  }
}

private class CryptoFailedException(operation: String, cause: Throwable? = null) :
  CodedException("Zami WebCrypto failed: $operation", cause)

private suspend fun <T> compute(block: () -> T): T =
  withContext(Dispatchers.Default) {
    try {
      block()
    } catch (error: CodedException) {
      throw error
    } catch (error: Exception) {
      throw CryptoFailedException(error.toString(), error)
    }
  }

internal fun digest(hash: Hash, data: ByteArray): ByteArray =
  MessageDigest.getInstance(hash.digest).digest(data)

/**
 * A keyed HMAC. Java refuses an empty key, which HMAC allows: HMAC pads its key with zeros
 * to the hash's block size, so an empty key and a single zero byte are the same key.
 */
internal fun hmac(hash: Hash, key: ByteArray): Mac {
  val mac = Mac.getInstance(hash.mac)
  mac.init(SecretKeySpec(if (key.isEmpty()) ByteArray(1) else key, hash.mac))
  return mac
}

/**
 * CTR over the whole 16-byte counter block, counting big-endian (as noble's `ctr`, and as
 * Java's CTR does): the JS side splits a message where WebCrypto's `length` counter bits wrap.
 */
internal fun aesCtr(key: ByteArray, counter: ByteArray, data: ByteArray): ByteArray {
  val cipher = Cipher.getInstance("AES/CTR/NoPadding")
  cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(counter))
  return cipher.doFinal(data)
}

/**
 * AES-GCM with a 128-bit tag. The JS side passes 12-byte ivs only. Encrypting gives the
 * ciphertext then the tag, as WebCrypto does; decrypting takes them that way, and gives null
 * when the data doesn't authenticate, which the JS side reports as WebCrypto's OperationError.
 */
internal fun aesGcm(
  encrypt: Boolean,
  key: ByteArray,
  iv: ByteArray,
  additionalData: ByteArray,
  data: ByteArray,
): ByteArray? {
  val cipher = Cipher.getInstance("AES/GCM/NoPadding")
  val mode = if (encrypt) Cipher.ENCRYPT_MODE else Cipher.DECRYPT_MODE
  cipher.init(mode, SecretKeySpec(key, "AES"), GCMParameterSpec(GCM_TAG_BITS, iv))
  if (additionalData.isNotEmpty()) cipher.updateAAD(additionalData)
  return try {
    cipher.doFinal(data)
  } catch (error: AEADBadTagException) {
    if (encrypt) throw error
    null
  }
}

/**
 * PBKDF2 (RFC 8018) over the password's bytes. Java's own (SecretKeyFactory) takes the
 * password as characters and encodes them, which can't carry arbitrary bytes, so this is
 * PBKDF2 itself on the platform's HMAC.
 */
internal fun pbkdf2(
  hash: Hash,
  password: ByteArray,
  salt: ByteArray,
  iterations: Int,
  length: Int,
): ByteArray {
  val mac = hmac(hash, password)
  val hashLength = mac.macLength
  val out = ByteArray(length)
  val u = ByteArray(hashLength)
  val t = ByteArray(hashLength)
  val index = ByteArray(4)
  var block = 1
  var offset = 0
  while (offset < length) {
    index[0] = (block ushr 24).toByte()
    index[1] = (block ushr 16).toByte()
    index[2] = (block ushr 8).toByte()
    index[3] = block.toByte()
    mac.update(salt)
    mac.update(index)
    mac.doFinal(u, 0)
    u.copyInto(t)
    for (round in 1 until iterations) {
      mac.update(u)
      mac.doFinal(u, 0)
      for (i in 0 until hashLength) t[i] = (t[i].toInt() xor u[i].toInt()).toByte()
    }
    val take = minOf(hashLength, length - offset)
    t.copyInto(out, offset, 0, take)
    offset += take
    block++
  }
  return out
}
