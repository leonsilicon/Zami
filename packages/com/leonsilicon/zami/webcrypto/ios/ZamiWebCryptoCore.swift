import CommonCrypto
import CryptoKit
import Foundation

/// The computations behind ZamiWebCryptoModule, apart from Expo so they compile and can be
/// checked on their own. Their arguments are already checked by the JS side.
enum ZamiWebCryptoCore {
  /// A computation that failed: the operation and CommonCrypto's status.
  struct Failure: Error, CustomStringConvertible {
    let operation: String
    let status: Int32
    var description: String { "\(operation) (status \(status))" }
  }

  /// The hashes the JS side passes, by their WebCrypto names.
  enum Hash {
    case sha256, sha512

    init(_ name: String) throws {
      switch name {
      case "SHA-256": self = .sha256
      case "SHA-512": self = .sha512
      default: throw Failure(operation: "hash \(name)", status: -1)
      }
    }

    var length: Int {
      switch self {
      case .sha256: return Int(CC_SHA256_DIGEST_LENGTH)
      case .sha512: return Int(CC_SHA512_DIGEST_LENGTH)
      }
    }

    var hmac: CCHmacAlgorithm {
      switch self {
      case .sha256: return CCHmacAlgorithm(kCCHmacAlgSHA256)
      case .sha512: return CCHmacAlgorithm(kCCHmacAlgSHA512)
      }
    }

    var prf: CCPseudoRandomAlgorithm {
      switch self {
      case .sha256: return CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256)
      case .sha512: return CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA512)
      }
    }
  }

  static let gcmTagBytes = 16

  static func digest(_ hash: String, _ data: Data) throws -> Data {
    let algorithm = try Hash(hash)
    var out = Data(count: algorithm.length)
    out.withUnsafeMutableBytes { out in
      data.withUnsafeBytes { data in
        let output = out.bindMemory(to: UInt8.self).baseAddress
        let length = CC_LONG(data.count)
        switch algorithm {
        case .sha256: _ = CC_SHA256(data.baseAddress, length, output)
        case .sha512: _ = CC_SHA512(data.baseAddress, length, output)
        }
      }
    }
    return out
  }

  static func hmac(_ hash: String, _ key: Data, _ data: Data) throws -> Data {
    let algorithm = try Hash(hash)
    var out = Data(count: algorithm.length)
    out.withUnsafeMutableBytes { out in
      key.withUnsafeBytes { key in
        data.withUnsafeBytes { data in
          CCHmac(algorithm.hmac, key.baseAddress, key.count, data.baseAddress, data.count, out.baseAddress)
        }
      }
    }
    return out
  }

  /// CTR over the whole 16-byte counter block, counting big-endian (as noble's `ctr`): the
  /// JS side splits a message where WebCrypto's `length` counter bits wrap.
  ///
  /// CommonCrypto's CTR counts in the block's low 64 bits only, wrapping them without
  /// carrying into the high 64, so a message that crosses that wrap is two runs here: up
  /// to it, then from the high half plus one and a low half of zero.
  static func aesCtr(_ key: Data, _ counter: Data, _ data: Data) throws -> Data {
    let low = counter.suffix(8).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    // Blocks before the low half wraps: 2^64 - low (more than any message when low is 0).
    let blocksBeforeWrap = low == 0 ? UInt64.max : 0 &- low
    let blocks = UInt64((data.count + 15) / 16)
    guard blocks > blocksBeforeWrap else { return try ctrRun(key, counter, data) }
    let split = data.startIndex + Int(blocksBeforeWrap) * 16
    let high = counter.prefix(8).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) } &+ 1
    var next = Data(count: 16)
    for i in 0..<8 { next[i] = UInt8(truncatingIfNeeded: high >> (56 - 8 * UInt64(i))) }
    var out = try ctrRun(key, counter, data[data.startIndex..<split])
    out.append(try ctrRun(key, next, data[split...]))
    return out
  }

  private static func ctrRun(_ key: Data, _ counter: Data, _ data: Data) throws -> Data {
    var cryptor: CCCryptorRef?
    var status = key.withUnsafeBytes { key in
      counter.withUnsafeBytes { counter in
        CCCryptorCreateWithMode(
          CCOperation(kCCEncrypt), CCMode(kCCModeCTR), CCAlgorithm(kCCAlgorithmAES),
          CCPadding(ccNoPadding), counter.baseAddress, key.baseAddress, key.count, nil, 0, 0,
          CCModeOptions(kCCModeOptionCTR_BE), &cryptor)
      }
    }
    guard status == CCCryptorStatus(kCCSuccess), let cryptor else {
      throw Failure(operation: "AES-CTR setup", status: status)
    }
    defer { CCCryptorRelease(cryptor) }
    var out = Data(count: data.count)
    var moved = 0
    status = out.withUnsafeMutableBytes { out in
      data.withUnsafeBytes { data in
        CCCryptorUpdate(cryptor, data.baseAddress, data.count, out.baseAddress, out.count, &moved)
      }
    }
    guard status == CCCryptorStatus(kCCSuccess), moved == data.count else {
      throw Failure(operation: "AES-CTR", status: status)
    }
    return out
  }

  /// AES-GCM with a 128-bit tag, in CryptoKit (CommonCrypto has no public GCM). The JS side
  /// passes 12-byte ivs only. Encrypting gives the ciphertext then the tag, as WebCrypto
  /// does; decrypting takes them that way, and gives nil when the data doesn't
  /// authenticate, which the JS side reports as WebCrypto's OperationError.
  static func aesGcm(
    encrypt: Bool, key: Data, iv: Data, additionalData: Data, data: Data
  ) throws -> Data? {
    let secret = SymmetricKey(data: key)
    let nonce = try AES.GCM.Nonce(data: iv)
    if encrypt {
      let sealed = try AES.GCM.seal(data, using: secret, nonce: nonce, authenticating: additionalData)
      var out = Data(capacity: sealed.ciphertext.count + sealed.tag.count)
      out.append(sealed.ciphertext)
      out.append(sealed.tag)
      return out
    }
    guard data.count >= gcmTagBytes else { return nil }
    let split = data.startIndex + data.count - gcmTagBytes
    let sealed = try AES.GCM.SealedBox(
      nonce: nonce, ciphertext: data[data.startIndex..<split], tag: data[split...])
    do {
      return try AES.GCM.open(sealed, using: secret, authenticating: additionalData)
    } catch CryptoKitError.authenticationFailure {
      return nil
    }
  }

  static func pbkdf2(
    _ hash: String, _ password: Data, _ salt: Data, _ iterations: Int, _ length: Int
  ) throws -> Data {
    let algorithm = try Hash(hash)
    guard iterations > 0, iterations <= Int(UInt32.max), length > 0 else {
      throw Failure(operation: "PBKDF2 arguments", status: -1)
    }
    var out = Data(count: length)
    let status = out.withUnsafeMutableBytes { out in
      password.withUnsafeBytes { password in
        salt.withUnsafeBytes { salt in
          CCKeyDerivationPBKDF(
            CCPBKDFAlgorithm(kCCPBKDF2),
            password.bindMemory(to: CChar.self).baseAddress, password.count,
            salt.bindMemory(to: UInt8.self).baseAddress, salt.count,
            algorithm.prf, UInt32(iterations),
            out.bindMemory(to: UInt8.self).baseAddress, length)
        }
      }
    }
    guard status == CCCryptorStatus(kCCSuccess) else {
      throw Failure(operation: "PBKDF2", status: status)
    }
    return out
  }
}
