package com.leonsilicon.zami.media;

import java.security.GeneralSecurityException;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * AES-256-CTR as WebCrypto's {@code { name: "AES-CTR", length: 64 }}, which Matrix
 * attachments use: the counter is the IV's low 64 bits, and it wraps without carrying into
 * the high 64. Java's CTR counts all 128 bits, so the cipher is restarted where the low half
 * wraps (never, for an IV whose low half is zero, as every Matrix client writes it).
 * Encrypting and decrypting are the same operation. Data can come in pieces of any size.
 * Plain Java (no Android APIs), so it is checked on a desktop JVM against WebCrypto.
 */
final class AesCtr {
  private final SecretKeySpec key;
  private final byte[] high;
  private Cipher cipher;
  /** Bytes until the low half of the counter wraps, or -1 if that's more than 2^62 away. */
  private long untilWrap;

  AesCtr(byte[] key, byte[] iv) throws GeneralSecurityException {
    if (key.length != 32 || iv.length != 16) {
      throw new GeneralSecurityException("AES-CTR needs a 32-byte key and a 16-byte IV");
    }
    this.key = new SecretKeySpec(key, "AES");
    high = Arrays.copyOfRange(iv, 0, 8);
    long low = 0;
    for (int i = 8; i < 16; i++) low = (low << 8) | (iv[i] & 0xff);
    // 2^64 - low blocks of 16 bytes, as an unsigned number.
    long blocks = -low;
    untilWrap =
        low == 0 || Long.compareUnsigned(blocks, Long.MAX_VALUE / 32) > 0 ? -1 : blocks * 16;
    cipher = make(iv);
  }

  private Cipher make(byte[] counter) throws GeneralSecurityException {
    Cipher made = Cipher.getInstance("AES/CTR/NoPadding");
    made.init(Cipher.ENCRYPT_MODE, key, new IvParameterSpec(counter));
    return made;
  }

  /** Encrypts (or decrypts) {@code length} bytes of {@code input} from {@code offset}. */
  byte[] update(byte[] input, int offset, int length) throws GeneralSecurityException {
    byte[] output = new byte[length];
    int done = 0;
    while (done < length) {
      int count = length - done;
      if (untilWrap >= 0 && count > untilWrap) count = (int) untilWrap;
      int moved = cipher.update(input, offset + done, count, output, done);
      if (moved != count) throw new GeneralSecurityException("AES-CTR held back bytes");
      done += count;
      if (untilWrap >= 0) {
        untilWrap -= count;
        if (untilWrap == 0) {
          cipher = make(Arrays.copyOf(high, 16));
          untilWrap = -1;
        }
      }
    }
    return output;
  }
}
