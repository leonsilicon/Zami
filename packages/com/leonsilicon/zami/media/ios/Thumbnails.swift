import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// `image` without transparency, over white: JPEG has no alpha, and transparent pixels
/// would come out black.
private func opaque(_ image: CGImage) -> CGImage {
  switch image.alphaInfo {
  case .none, .noneSkipFirst, .noneSkipLast: return image
  default: break
  }
  let rect = CGRect(x: 0, y: 0, width: image.width, height: image.height)
  guard
    let context = CGContext(
      data: nil, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
  else { return image }
  context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  context.fill(rect)
  context.draw(image, in: rect)
  return context.makeImage() ?? image
}

/// Writes `image` to `dest` as a JPEG and describes it for the JS side.
private func writeJpeg(
  _ image: CGImage, to dest: String, quality: Double, width: Int, height: Int
) throws -> [String: Any] {
  let url = try fileURL(dest)
  try prepareParent(url)
  guard
    let destination = CGImageDestinationCreateWithURL(
      url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)
  else { throw MediaException("Can't write a JPEG to \(url.path)") }
  CGImageDestinationAddImage(
    destination, opaque(image),
    [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
  guard CGImageDestinationFinalize(destination) else {
    throw MediaException("Can't encode a JPEG")
  }
  let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
  return [
    "width": width, "height": height, "thumbWidth": image.width, "thumbHeight": image.height,
    "size": size,
  ]
}

/// A frame about a tenth of the way into the video at `uri` (at most 1 s in, past the
/// black frames videos start with), upright and fitted in `maxEdge`.
func videoThumbnail(uri: String, dest: String, maxEdge: Double, quality: Double) async throws
  -> [String: Any]
{
  let asset = AVURLAsset(url: try fileURL(uri))
  let duration = try await asset.load(.duration)
  guard let track = try await asset.loadTracks(withMediaType: .video).first else {
    throw MediaException("No video track")
  }
  let (natural, transform) = try await track.load(.naturalSize, .preferredTransform)
  let shown = natural.applying(transform)
  let generator = AVAssetImageGenerator(asset: asset)
  generator.appliesPreferredTrackTransform = true
  generator.maximumSize = CGSize(width: maxEdge, height: maxEdge)
  let seconds = duration.seconds.isFinite ? min(1, max(0, duration.seconds * 0.1)) : 0
  let (image, _) = try await generator.image(
    at: CMTime(seconds: seconds, preferredTimescale: 600))
  return try writeJpeg(
    image, to: dest, quality: quality, width: Int(abs(shown.width).rounded()),
    height: Int(abs(shown.height).rounded()))
}

/// The image at `uri`, upright (its Exif orientation applied) and fitted in `maxEdge`,
/// decoded at that size rather than in full.
func imageThumbnail(uri: String, dest: String, maxEdge: Double, quality: Double) throws
  -> [String: Any]
{
  let url = try fileURL(uri)
  guard
    let source = CGImageSourceCreateWithURL(
      url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
    let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
    let pixelWidth = properties[kCGImagePropertyPixelWidth] as? Int,
    let pixelHeight = properties[kCGImagePropertyPixelHeight] as? Int
  else { throw MediaException("Can't read the image") }
  // Orientations 5 to 8 turn the picture a quarter.
  let orientation = properties[kCGImagePropertyOrientation] as? UInt32 ?? 1
  let turned = orientation >= 5 && orientation <= 8
  let options: [CFString: Any] = [
    kCGImageSourceCreateThumbnailFromImageAlways: true,
    kCGImageSourceCreateThumbnailWithTransform: true,
    kCGImageSourceShouldCacheImmediately: true,
    kCGImageSourceThumbnailMaxPixelSize: Int(maxEdge),
  ]
  guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
    throw MediaException("Can't decode the image")
  }
  return try writeJpeg(
    image, to: dest, quality: quality, width: turned ? pixelHeight : pixelWidth,
    height: turned ? pixelWidth : pixelHeight)
}
