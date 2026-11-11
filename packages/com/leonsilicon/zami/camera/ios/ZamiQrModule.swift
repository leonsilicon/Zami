import ExpoModulesCore

/// The QR codes in an image file, for Zami's QR scanner (@-/com.leonsilicon.zami.camera).
/// Matrix codes are binary, and the platform scanners' text (`payloadStringValue`,
/// AVFoundation's `stringValue`) can't carry arbitrary bytes, so this gives each code's
/// error-corrected data codewords and its version (ZamiQrCore.swift), which the JS side
/// parses into the payload's exact bytes. It runs off the JS thread.
public class ZamiQrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZamiQr")

    AsyncFunction("decodeQrCodes") { (uri: URL) throws -> [[String: Any]] in
      guard let codes = ZamiQrCore.codes(at: uri) else {
        throw QrImageUnreadableException(uri.absoluteString)
      }
      return codes
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))
  }
}

private final class QrImageUnreadableException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "Couldn't read the image at \(param)"
  }
}
