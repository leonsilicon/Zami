import { Image as ExpoImage, type ImageSource } from "expo-image";
import { withUniwind } from "uniwind";

/** expo-image's `Image`, taking Zam's Tailwind classes in `className`. */
export const Image = withUniwind(ExpoImage);

let headersFor: (url: string) => Record<string, string> | undefined = () => undefined;

/**
 * Sets the request headers an image URL needs. The app registers this once: on the web
 * Zam's service worker adds the account's token to authenticated Matrix media requests.
 */
export function setMediaHeaders(
  headers: (url: string) => Record<string, string> | undefined,
): void {
  headersFor = headers;
}

/** The image source for a URL Zam would put in an `<img src>`. */
export function mediaSource(url: string | null | undefined): ImageSource | undefined {
  if (!url) return undefined;
  const headers = headersFor(url);
  return headers ? { uri: url, headers } : { uri: url };
}
