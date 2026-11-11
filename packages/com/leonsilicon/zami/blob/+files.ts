// File-backed blobs and object URLs, without the installer: nothing here imports React
// Native or Expo, so Zam's code that uses it still loads in its jsdom tests.
export { extensionFor } from "#extension";
export { createObjectURLAsync } from "#patch";
export {
  blobSegments,
  fileFromUri,
  fileSegments,
  isFileSegment,
  isPartsBlob,
  PartsFile,
  partsSegments,
  readSegments,
  segmentsFile,
  setFileIo,
  wholeFileUri,
  type FileFromUriOptions,
  type FileIo,
  type FileSegment,
  type Segment,
} from "#parts";
