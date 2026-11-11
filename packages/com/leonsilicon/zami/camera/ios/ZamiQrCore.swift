import CoreImage
import Foundation
import Vision

/// The decoding behind ZamiQrModule, apart from Expo so it compiles and can be checked on
/// its own: the QR codes in an image, with Vision, and Core Image's detector when Vision
/// finds none. Each code as its version and error-corrected data codewords
/// (`CIQRCodeDescriptor`), which the JS side parses into the payload's exact bytes.
enum ZamiQrCore {
  /// The codes in the image at a file URL, or nil when the file isn't an image.
  static func codes(at url: URL) -> [[String: Any]]? {
    guard let image = CIImage(contentsOf: url) else { return nil }
    return codes(in: image)
  }

  static func codes(in image: CIImage) -> [[String: Any]] {
    var found = visionCodes(in: image)
    if found.isEmpty { found = detectorCodes(in: image) }
    return found.map { code in
      [
        "version": code.symbolVersion,
        "codewords": code.errorCorrectedPayload.map { Int($0) },
      ]
    }
  }

  private static func visionCodes(in image: CIImage) -> [CIQRCodeDescriptor] {
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    do {
      try VNImageRequestHandler(ciImage: image, options: [:]).perform([request])
    } catch {
      return []
    }
    return (request.results ?? []).compactMap { $0.barcodeDescriptor as? CIQRCodeDescriptor }
  }

  private static func detectorCodes(in image: CIImage) -> [CIQRCodeDescriptor] {
    let detector = CIDetector(
      ofType: CIDetectorTypeQRCode, context: nil,
      options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])
    return (detector?.features(in: image) ?? []).compactMap {
      ($0 as? CIQRCodeFeature)?.symbolDescriptor
    }
  }
}
