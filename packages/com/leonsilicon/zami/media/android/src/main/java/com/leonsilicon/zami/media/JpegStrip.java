package com.leonsilicon.zami.media;

import java.io.ByteArrayOutputStream;

/**
 * Zam's JPEG metadata stripping (src/lib/utils/stripMetadata.ts, {@code stripJpeg}), byte for
 * byte: every APPn and COM segment is dropped except JFIF, the ICC profile and Adobe's
 * colour-transform marker, bytes after the end of the image are dropped, and the Exif
 * orientation is kept as an Exif block of its own. Native because finding the end of the
 * entropy-coded data means looking at every byte, which for a photo of several megabytes
 * blocks Hermes for a good part of a second. Plain Java (no Android APIs), so it is checked
 * on a desktop JVM against Zam's own code.
 */
final class JpegStrip {
  private JpegStrip() {}

  private static int u8(byte[] b, int at) {
    return b[at] & 0xff;
  }

  private static boolean ascii(byte[] b, int at, String text) {
    // As Zam's ascii(): only what's inside the buffer is compared.
    if (at < 0 || at + text.length() > b.length) return false;
    for (int i = 0; i < text.length(); i++) {
      if (u8(b, at + i) != text.charAt(i)) return false;
    }
    return true;
  }

  private static int u16(byte[] b, int at, boolean le) {
    return le ? u8(b, at) | u8(b, at + 1) << 8 : u8(b, at) << 8 | u8(b, at + 1);
  }

  private static long u32(byte[] b, int at, boolean le) {
    return le
        ? (u8(b, at) | u8(b, at + 1) << 8 | u8(b, at + 2) << 16 | (long) u8(b, at + 3) << 24)
        : ((long) u8(b, at) << 24 | u8(b, at + 1) << 16 | u8(b, at + 2) << 8 | u8(b, at + 3));
  }

  /** Orientation (2..8; 1 and unknown give 0) from a TIFF header at {@code base}. */
  private static int tiffOrientation(byte[] b, int from, int to, int base) {
    int length = to - from;
    if (base < 0 || base + 8 > length) return 0;
    int at = from + base;
    boolean le = u8(b, at) == 0x49 && u8(b, at + 1) == 0x49;
    if (!le && !(u8(b, at) == 0x4d && u8(b, at + 1) == 0x4d)) return 0;
    if (u16(b, at + 2, le) != 42) return 0;
    long ifd = base + u32(b, at + 4, le);
    if (ifd + 2 > length) return 0;
    int n = u16(b, from + (int) ifd, le);
    for (int i = 0; i < n; i++) {
      long e = ifd + 2 + i * 12L;
      if (e + 12 > length) return 0;
      if (u16(b, from + (int) e, le) == 0x0112) {
        int o = u16(b, from + (int) e + 8, le);
        return o >= 2 && o <= 8 ? o : 0;
      }
    }
    return 0;
  }

  /** Exif payload {@code b[from, to)} (with or without "Exif\0\0") to orientation, or 0. */
  private static int exifOrientation(byte[] b, int from, int to) {
    boolean prefixed = to - from >= 6 && ascii(b, from, "Exif\0\0");
    return tiffOrientation(b, from, to, prefixed ? 6 : 0);
  }

  /** The segment holding nothing but the orientation, as Zam builds it. */
  private static byte[] orientationSegment(int o) {
    byte[] tiff = {
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00,
      0x00, 0x00, 0x01, 0x00, (byte) o, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    };
    byte[] seg = new byte[4 + 6 + tiff.length];
    seg[0] = (byte) 0xff;
    seg[1] = (byte) 0xe1;
    int length = 2 + 6 + tiff.length;
    seg[2] = (byte) (length >> 8);
    seg[3] = (byte) length;
    byte[] exif = {0x45, 0x78, 0x69, 0x66, 0, 0};
    System.arraycopy(exif, 0, seg, 4, 6);
    System.arraycopy(tiff, 0, seg, 10, tiff.length);
    return seg;
  }

  /** The stripped JPEG, or null if {@code b} isn't a JPEG this understands (send it as is). */
  static byte[] strip(byte[] b) {
    int length = b.length;
    if (length < 4 || u8(b, 0) != 0xff || u8(b, 1) != 0xd8) return null;
    // Kept ranges [start, end) of b, in order; the Exif block goes in at exifAt.
    java.util.ArrayList<int[]> kept = new java.util.ArrayList<>();
    int exifAt = 0;
    int orientation = 0;
    int i = 2;
    scan:
    while (i + 1 < length) {
      if (u8(b, i) != 0xff) return null;
      int m = u8(b, i + 1);
      while (m == 0xff && i + 2 < length) {
        i++;
        m = u8(b, i + 1);
      }
      if (m == 0xd9) {
        // Anything after EOI is dropped.
        kept.add(new int[] {i, Math.min(i + 2, length)});
        break;
      }
      if (m == 0x01 || (m >= 0xd0 && m <= 0xd8)) {
        kept.add(new int[] {i, Math.min(i + 2, length)});
        i += 2;
        continue;
      }
      if (i + 4 > length) return null;
      int segLength = u16(b, i + 2, false);
      if (segLength < 2 || i + 2 + segLength > length) return null;
      int segEnd = i + 2 + segLength;
      int body = i + 4;
      boolean keep = true;
      if (m >= 0xe0 && m <= 0xef) {
        if (m == 0xe0) keep = ascii(b, body, "JFIF\0");
        else if (m == 0xe2) keep = ascii(b, body, "ICC_PROFILE\0");
        else if (m == 0xee) keep = ascii(b, body, "Adobe");
        else keep = false;
        if (m == 0xe1 && orientation == 0) orientation = exifOrientation(b, body, segEnd);
      } else if (m == 0xfe) {
        keep = false;
      }
      if (keep) {
        // The Exif block goes right after any leading JFIF APP0.
        if (m == 0xe0 && exifAt == kept.size()) exifAt++;
        kept.add(new int[] {i, segEnd});
      }
      i = segEnd;
      if (m == 0xda) {
        // Entropy-coded data: copy to the next real marker.
        int j = i;
        while (j + 1 < length) {
          int n = u8(b, j + 1);
          if (u8(b, j) == 0xff && n != 0x00 && n != 0xff && !(n >= 0xd0 && n <= 0xd7)) break;
          j++;
        }
        kept.add(new int[] {i, j});
        i = j;
        // Truncated file.
        if (j + 1 >= length) break scan;
      }
    }
    ByteArrayOutputStream out = new ByteArrayOutputStream(length);
    out.write(b, 0, 2);
    for (int k = 0; k < kept.size(); k++) {
      if (k == exifAt && orientation != 0) {
        byte[] seg = orientationSegment(orientation);
        out.write(seg, 0, seg.length);
      }
      int[] range = kept.get(k);
      out.write(b, range[0], range[1] - range[0]);
    }
    if (exifAt >= kept.size() && orientation != 0) {
      byte[] seg = orientationSegment(orientation);
      out.write(seg, 0, seg.length);
    }
    return out.toByteArray();
  }
}
