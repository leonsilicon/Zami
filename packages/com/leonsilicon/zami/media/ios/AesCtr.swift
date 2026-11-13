import CommonCrypto
import Foundation

/// AES-256-CTR as WebCrypto's `{ name: "AES-CTR", length: 64 }`, which Matrix attachments
/// use: the counter is the IV's low 64 bits, and it wraps without carrying into the high
/// 64. CommonCrypto counts all 128 bits, so the cryptor is restarted where the low half
/// wraps (never, for an IV whose low half is zero, as every Matrix client writes it).
/// Encrypting and decrypting are the same operation. Data can come in pieces of any size.
final class AesCtr {
  private let key: Data
  private let high: Data
  private var cryptor: CCCryptorRef
  /// Bytes until the low half of the counter wraps, or nil if that's more than 2^63 away.
  private var untilWrap: UInt64?

  init(key: Data, iv: Data) throws {
    guard key.count == 32, iv.count == 16 else {
      throw MediaException("AES-CTR needs a 32-byte key and a 16-byte IV")
    }
    self.key = key
    high = iv.prefix(8)
    let low = iv.suffix(8).reduce(UInt64(0)) { $0 << 8 | UInt64($1) }
    // 2^64 - low blocks of 16 bytes.
    let blocks = 0 &- low
    untilWrap = low == 0 || blocks > UInt64.max / 32 ? nil : blocks * 16
    cryptor = try Self.make(key: key, counter: iv)
  }

  deinit {
    CCCryptorRelease(cryptor)
  }

  private static func make(key: Data, counter: Data) throws -> CCCryptorRef {
    var cryptor: CCCryptorRef?
    let status = key.withUnsafeBytes { key in
      counter.withUnsafeBytes { counter in
        CCCryptorCreateWithMode(
          CCOperation(kCCEncrypt), CCMode(kCCModeCTR), CCAlgorithm(kCCAlgorithmAES),
          CCPadding(ccNoPadding), counter.baseAddress, key.baseAddress, key.count, nil, 0, 0,
          CCModeOptions(kCCModeOptionCTR_BE), &cryptor)
      }
    }
    guard status == CCCryptorStatus(kCCSuccess), let cryptor else {
      throw MediaException("AES-CTR setup failed (status \(status))")
    }
    return cryptor
  }

  func update(_ input: Data) throws -> Data {
    var output = Data(count: input.count)
    var done = 0
    while done < input.count {
      var count = input.count - done
      if let left = untilWrap, UInt64(count) > left { count = Int(left) }
      var moved = 0
      let status = input.withUnsafeBytes { input in
        output.withUnsafeMutableBytes { output in
          CCCryptorUpdate(
            cryptor, input.baseAddress! + done, count, output.baseAddress! + done, count, &moved)
        }
      }
      guard status == CCCryptorStatus(kCCSuccess), moved == count else {
        throw MediaException("AES-CTR failed (status \(status))")
      }
      done += count
      if let left = untilWrap {
        if left == UInt64(count) {
          CCCryptorRelease(cryptor)
          cryptor = try Self.make(key: key, counter: high + Data(count: 8))
          untilWrap = nil
        } else {
          untilWrap = left - UInt64(count)
        }
      }
    }
    return output
  }
}
