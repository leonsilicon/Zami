// Blobs that Zam's code and matrix-js-sdk can build from bytes and read: React Native's
// Blob is a handle to native data, which can't be made from an ArrayBuffer and has no
// arrayBuffer(). Installed after the polyfills, before any of Zam's modules load.
import { installBlobPolyfill } from "@-/com.leonsilicon.zami.blob";

installBlobPolyfill();
