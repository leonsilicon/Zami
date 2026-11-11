import Foundation

/// Zam's JPEG metadata stripping (src/lib/utils/stripMetadata.ts, `stripJpeg`), byte for
/// byte: every APPn and COM segment is dropped except JFIF, the ICC profile and Adobe's
/// colour-transform marker, bytes after the end of the image are dropped, and the Exif
/// orientation is kept as an Exif block of its own. Native because finding the end of the
/// entropy-coded data means looking at every byte, which for a photo of several megabytes
/// blocks Hermes for a good part of a second. Foundation only, so it is checked on macOS
/// against Zam's own code.
enum JpegStrip {
  private static func ascii(_ b: [UInt8], _ at: Int, _ text: String) -> Bool {
    // As Zam's ascii(): only what's inside the buffer is compared.
    let bytes = Array(text.utf8)
    guard at >= 0, at + bytes.count <= b.count else { return false }
    for (offset, byte) in bytes.enumerated() where b[at + offset] != byte { return false }
    return true
  }

  private static func u16(_ b: [UInt8], _ at: Int, _ le: Bool) -> Int {
    le ? Int(b[at]) | Int(b[at + 1]) << 8 : Int(b[at]) << 8 | Int(b[at + 1])
  }

  private static func u32(_ b: [UInt8], _ at: Int, _ le: Bool) -> Int {
    le
      ? Int(b[at]) | Int(b[at + 1]) << 8 | Int(b[at + 2]) << 16 | Int(b[at + 3]) << 24
      : Int(b[at]) << 24 | Int(b[at + 1]) << 16 | Int(b[at + 2]) << 8 | Int(b[at + 3])
  }

  /// Orientation (2...8; 1 and unknown give nil) from a TIFF header at `base` of `b[from..<to]`.
  private static func tiffOrientation(_ b: [UInt8], _ from: Int, _ to: Int, _ base: Int) -> Int? {
    let length = to - from
    guard base >= 0, base + 8 <= length else { return nil }
    let at = from + base
    let le = b[at] == 0x49 && b[at + 1] == 0x49
    guard le || (b[at] == 0x4d && b[at + 1] == 0x4d) else { return nil }
    guard u16(b, at + 2, le) == 42 else { return nil }
    let ifd = base + u32(b, at + 4, le)
    guard ifd + 2 <= length else { return nil }
    let n = u16(b, from + ifd, le)
    for i in 0..<n {
      let e = ifd + 2 + i * 12
      guard e + 12 <= length else { return nil }
      if u16(b, from + e, le) == 0x0112 {
        let o = u16(b, from + e + 8, le)
        return o >= 2 && o <= 8 ? o : nil
      }
    }
    return nil
  }

  /// Exif payload `b[from..<to]` (with or without "Exif\0\0") to orientation.
  private static func exifOrientation(_ b: [UInt8], _ from: Int, _ to: Int) -> Int? {
    let prefixed = to - from >= 6 && ascii(b, from, "Exif\0\0")
    return tiffOrientation(b, from, to, prefixed ? 6 : 0)
  }

  /// The segment holding nothing but the orientation, as Zam builds it.
  private static func orientationSegment(_ o: Int) -> [UInt8] {
    let tiff: [UInt8] = [
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00,
      0x00, 0x00, 0x01, 0x00, UInt8(o), 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]
    let length = 2 + 6 + tiff.count
    return [0xff, 0xe1, UInt8(length >> 8), UInt8(length & 0xff), 0x45, 0x78, 0x69, 0x66, 0, 0]
      + tiff
  }

  /// The stripped JPEG, or nil if `b` isn't a JPEG this understands (send it as is).
  static func strip(_ b: [UInt8]) -> [UInt8]? {
    let length = b.count
    guard length >= 4, b[0] == 0xff, b[1] == 0xd8 else { return nil }
    // Kept ranges of b, in order; the Exif block goes in at exifAt.
    var kept: [Range<Int>] = []
    var exifAt = 0
    var orientation: Int?
    var i = 2
    scan: while i + 1 < length {
      guard b[i] == 0xff else { return nil }
      var m = b[i + 1]
      while m == 0xff && i + 2 < length {
        i += 1
        m = b[i + 1]
      }
      if m == 0xd9 {
        // Anything after EOI is dropped.
        kept.append(i..<min(i + 2, length))
        break
      }
      if m == 0x01 || (m >= 0xd0 && m <= 0xd8) {
        kept.append(i..<min(i + 2, length))
        i += 2
        continue
      }
      guard i + 4 <= length else { return nil }
      let segLength = u16(b, i + 2, false)
      guard segLength >= 2, i + 2 + segLength <= length else { return nil }
      let segEnd = i + 2 + segLength
      let body = i + 4
      var keep = true
      if m >= 0xe0 && m <= 0xef {
        switch m {
        case 0xe0: keep = ascii(b, body, "JFIF\0")
        case 0xe2: keep = ascii(b, body, "ICC_PROFILE\0")
        case 0xee: keep = ascii(b, body, "Adobe")
        default: keep = false
        }
        if m == 0xe1 && orientation == nil { orientation = exifOrientation(b, body, segEnd) }
      } else if m == 0xfe {
        keep = false
      }
      if keep {
        // The Exif block goes right after any leading JFIF APP0.
        if m == 0xe0 && exifAt == kept.count { exifAt += 1 }
        kept.append(i..<segEnd)
      }
      i = segEnd
      if m == 0xda {
        // Entropy-coded data: copy to the next real marker.
        var j = i
        while j + 1 < length {
          let n = b[j + 1]
          if b[j] == 0xff && n != 0x00 && n != 0xff && !(n >= 0xd0 && n <= 0xd7) { break }
          j += 1
        }
        kept.append(i..<max(i, j))
        i = j
        // Truncated file.
        if j + 1 >= length { break scan }
      }
    }
    var out: [UInt8] = []
    out.reserveCapacity(length)
    out.append(contentsOf: b[0..<2])
    for (index, range) in kept.enumerated() {
      if index == exifAt, let orientation { out.append(contentsOf: orientationSegment(orientation)) }
      out.append(contentsOf: b[range])
    }
    if exifAt >= kept.count, let orientation {
      out.append(contentsOf: orientationSegment(orientation))
    }
    return out
  }
}
