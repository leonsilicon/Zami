import CommonCrypto
import ExpoModulesCore

/// The costly part of Zami's `crypto.subtle` (@-/com.leonsilicon.zami.webcrypto), in
/// CommonCrypto and off the JS thread: digests, HMAC and AES-CTR over whole attachments
/// and key files, and PBKDF2's hundreds of thousands of iterations. The JS side checks
/// every argument first, so these only compute.
public class ZamiWebCryptoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZamiWebCrypto")

    AsyncFunction("digest") { (hash: String, data: Data) throws -> Data in
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

    AsyncFunction("hmac") { (hash: String, key: Data, data: Data) throws -> Data in
      let algorithm = try Hash(hash)
      var out = Data(count: algorithm.length)
      out.withUnsafeMutableBytes { out in
        key.withUnsafeBytes { key in
          data.withUnsafeBytes { data in
            CCHmac(
              algorithm.hmac, key.baseAddress, key.count, data.baseAddress, data.count,
              out.baseAddress)
          }
        }
      }
      return out
    }

    // CTR over the whole 16-byte counter block, counting big-endian (as noble's `ctr`):
    // the JS side splits a message where WebCrypto's `length` counter bits wrap.
    AsyncFunction("aesCtr") { (key: Data, counter: Data, data: Data) throws -> Data in
      var cryptor: CCCryptorRef?
      var status = key.withUnsafeBytes { key in
        counter.withUnsafeBytes { counter in
          CCCryptorCreateWithMode(
            CCOperation(kCCEncrypt), CCMode(kCCModeCTR), CCAlgorithm(kCCAlgorithmAES),
            CCPadding(ccNoPadding), counter.baseAddress, key.baseAddress, key.count, nil, 0, 0,
            CCModeOptions(kCCModeOptionCTR_BE), &cryptor)
        }
      }
      guard status == CCCryptorStatus(kCCSuccess), let cryptor else { throw CryptoFailed("AES-CTR setup", status) }
      defer { CCCryptorRelease(cryptor) }
      var out = Data(count: data.count)
      var moved = 0
      status = out.withUnsafeMutableBytes { out in
        data.withUnsafeBytes { data in
          CCCryptorUpdate(cryptor, data.baseAddress, data.count, out.baseAddress, out.count, &moved)
        }
      }
      guard status == CCCryptorStatus(kCCSuccess), moved == data.count else { throw CryptoFailed("AES-CTR", status) }
      return out
    }

    AsyncFunction("pbkdf2") {
      (hash: String, password: Data, salt: Data, iterations: Int, length: Int) throws -> Data in
      let algorithm = try Hash(hash)
      guard iterations > 0, iterations <= Int(UInt32.max), length > 0 else {
        throw CryptoFailed("PBKDF2 arguments", -1)
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
      guard status == CCCryptorStatus(kCCSuccess) else { throw CryptoFailed("PBKDF2", status) }
      return out
    }
  }
}

/// The hashes the JS side passes, by their WebCrypto names.
private enum Hash {
  case sha256, sha512

  init(_ name: String) throws {
    switch name {
    case "SHA-256": self = .sha256
    case "SHA-512": self = .sha512
    default: throw CryptoFailed("hash \(name)", -1)
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

private final class CryptoFailedException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "CommonCrypto failed: \(param)"
  }
}

private func CryptoFailed(_ operation: String, _ status: Int32) -> CryptoFailedException {
  CryptoFailedException("\(operation) (status \(status))")
}
