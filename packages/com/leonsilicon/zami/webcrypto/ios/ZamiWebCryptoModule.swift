import ExpoModulesCore

/// Where the functions run: a concurrent queue of their own rather than Expo's shared
/// serial `expo.modules.AsyncFunctionQueue`, so a long job (PBKDF2's hundreds of thousands
/// of iterations, hashing a large attachment) holds up neither the other modules' async
/// functions nor another crypto call. The functions share no state, so they can overlap.
private let cryptoQueue = DispatchQueue(
  label: "com.leonsilicon.zami.webcrypto", qos: .userInitiated, attributes: .concurrent)

/// The costly part of Zami's `crypto.subtle` (@-/com.leonsilicon.zami.webcrypto), in
/// CommonCrypto and CryptoKit and off the JS thread: digests, HMAC, AES-CTR and AES-GCM
/// over whole attachments, key files and file-transfer blocks, and PBKDF2's hundreds of
/// thousands of iterations. The JS side checks every argument first, so these only compute
/// (ZamiWebCryptoCore.swift).
public class ZamiWebCryptoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZamiWebCrypto")

    AsyncFunction("digest") { (hash: String, data: Data) throws -> Data in
      try reported { try ZamiWebCryptoCore.digest(hash, data) }
    }.runOnQueue(cryptoQueue)

    AsyncFunction("hmac") { (hash: String, key: Data, data: Data) throws -> Data in
      try reported { try ZamiWebCryptoCore.hmac(hash, key, data) }
    }.runOnQueue(cryptoQueue)

    AsyncFunction("aesCtr") { (key: Data, counter: Data, data: Data) throws -> Data in
      try reported { try ZamiWebCryptoCore.aesCtr(key, counter, data) }
    }.runOnQueue(cryptoQueue)

    AsyncFunction("aesGcm") {
      (encrypt: Bool, key: Data, iv: Data, additionalData: Data, data: Data) throws -> Data? in
      try reported {
        try ZamiWebCryptoCore.aesGcm(
          encrypt: encrypt, key: key, iv: iv, additionalData: additionalData, data: data)
      }
    }.runOnQueue(cryptoQueue)

    AsyncFunction("pbkdf2") {
      (hash: String, password: Data, salt: Data, iterations: Int, length: Int) throws -> Data in
      try reported { try ZamiWebCryptoCore.pbkdf2(hash, password, salt, iterations, length) }
    }.runOnQueue(cryptoQueue)
  }
}

/// Runs a computation, reporting its failure to JS as an Expo exception.
private func reported<T>(_ compute: () throws -> T) throws -> T {
  do {
    return try compute()
  } catch {
    throw CryptoFailedException(String(describing: error))
  }
}

private final class CryptoFailedException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Zami WebCrypto failed: \(param)"
  }
}
