// Web Audio, `Audio` and WebCodecs' Opus decoder for Zam's code, on react-native-audio-api.
// The globals this module exports become `window` members, and Metro points Zam's
// references (`AudioContext`, `new Audio()`, …) to them here.
//
// - AudioContext, OfflineAudioContext: react-native-audio-api's, plus what the web has
//   that Zam uses: `decodeAudioData` with callbacks and for WebM Opus (rewrapped as Ogg
//   Opus, which iOS decodes; Chromium records voice messages as WebM), and `setSinkId`
//   for the one output there is. No MediaStream nodes (calls have their own audio) and
//   no AudioWorklet.
// - Audio: an HTMLAudioElement that plays a file through a react-native-audio-api file
//   source, streaming it from disk: `blob:` URLs (the Blob polyfill's object URLs are
//   files), `data:`, `http(s):`, and Zam's own static paths (`/sounds/…`, #fetch).
// - AudioDecoder, EncodedAudioChunk: Opus only (the bundled SoundFont's samples). The
//   packets are decoded together on `flush()`.
import { File, FileMode } from "expo-file-system";
import * as AudioApi from "react-native-audio-api";
import { staticFileUri } from "#fetch";
import { isWebM, oggOpus, opusHead, webmOpusToOgg } from "#opus";

type ApiAudioBuffer = AudioApi.AudioBuffer;

function domError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

// --- Decoding ---

/** `bytes` as react-native-audio-api can decode them: WebM Opus rewrapped as Ogg Opus. */
function decodable(bytes: ArrayBuffer): ArrayBuffer {
  const view = new Uint8Array(bytes);
  return (isWebM(view) && webmOpusToOgg(view)?.buffer) || bytes;
}

async function decodeBytes(bytes: ArrayBuffer, sampleRate: number): Promise<ApiAudioBuffer> {
  try {
    return await AudioApi.decodeAudioData(decodable(bytes), sampleRate);
  } catch (error) {
    throw domError("EncodingError", `Unable to decode audio data: ${String(error)}`);
  }
}

type DecodeSuccess = ((buffer: ApiAudioBuffer) => void) | null | undefined;
type DecodeFailure = ((error: Error) => void) | null | undefined;

/** Web Audio's `decodeAudioData(data, success?, failure?)` on `context`. */
function decodeAudioDataFor(
  context: { readonly sampleRate: number },
  data: ArrayBuffer,
  success: DecodeSuccess,
  failure: DecodeFailure,
): Promise<ApiAudioBuffer> {
  const decoded =
    data instanceof ArrayBuffer
      ? decodeBytes(data, context.sampleRate)
      : Promise.reject(new TypeError("decodeAudioData: the data must be an ArrayBuffer"));
  decoded.then(
    (buffer) => success?.(buffer),
    (error: Error) => failure?.(error),
  );
  return decoded;
}

// --- Contexts ---

/** In development, the contexts made last (for the debugger). */
const recentContexts: ZamiAudioContext[] = [];

class ZamiAudioContext extends AudioApi.AudioContext {
  /** The output device: there's one, the one iOS routes to. */
  readonly sinkId = "";

  constructor(options?: AudioApi.AudioContextOptions) {
    super(options);
    if (__DEV__ && recentContexts.push(this) > 8) recentContexts.shift();
  }

  // oxlint-disable-next-line typescript/ban-ts-comment
  // @ts-expect-error: the web's signature (callbacks), not react-native-audio-api's (fetch options).
  override decodeAudioData(
    data: ArrayBuffer,
    success?: DecodeSuccess,
    failure?: DecodeFailure,
  ): Promise<ApiAudioBuffer> {
    return decodeAudioDataFor(this, data, success, failure);
  }

  setSinkId(id: string | { type: "none" }): Promise<void> {
    return id === "" || id === "default"
      ? Promise.resolve()
      : Promise.reject(domError("NotFoundError", "Zami: there's only the default output"));
  }

  // An <audio> element can't feed a graph here. (Nor can MediaStreams: there are no
  // createMediaStreamSource and createMediaStreamDestination, as in a browser without.)
  override createMediaElementSource(): never {
    throw domError("NotSupportedError", "Zami: an audio element can't feed Web Audio");
  }
}

class ZamiOfflineAudioContext extends AudioApi.OfflineAudioContext {
  // oxlint-disable-next-line typescript/ban-ts-comment
  // @ts-expect-error: the web's signature (callbacks), not react-native-audio-api's (fetch options).
  override decodeAudioData(
    data: ArrayBuffer,
    success?: DecodeSuccess,
    failure?: DecodeFailure,
  ): Promise<ApiAudioBuffer> {
    return decodeAudioDataFor(this, data, success, failure);
  }
}

// --- <audio> ---

/** react-native-audio-api's native file source (its JS class isn't exported). */
interface NativeFileSource {
  readonly duration: number;
  readonly currentTime: number;
  volume: number;
  loop: boolean;
  playbackRate: number;
  preservesPitch: boolean;
  onended: string;
  onpositionchanged: string;
  start(when: number): void;
  pause(): void;
  seekToTime(seconds: number): void;
  disconnect(destination?: unknown): void;
}

interface NativeEventEmitter {
  addAudioEventListener(name: string, callback: (event: { value?: number }) => void): string;
  removeAudioEventListener(name: string, id: string): void;
}

const emitter = (): NativeEventEmitter =>
  (globalThis as unknown as { AudioEventEmitter: NativeEventEmitter }).AudioEventEmitter;

/** What a file source plays: a file's path, or the bytes of one. */
type Source = string | ArrayBuffer;

/** The local path of a `file://` URI. */
function filePath(uri: string): string {
  return decodeURI(uri.replace(/^file:\/\//, ""));
}

/** A local file to play from disk, or its bytes when it needs rewrapping (WebM). */
function fileSource(uri: string): Source {
  const file = new File(uri);
  const handle = file.open(FileMode.ReadOnly);
  let magic: Uint8Array;
  try {
    magic = handle.readBytesSync(4);
  } finally {
    handle.close();
  }
  if (!isWebM(magic)) return filePath(uri);
  return decodable(file.bytesSync().buffer as ArrayBuffer);
}

function base64Bytes(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** What `src` plays, read or downloaded as needed. */
async function resolveSource(src: string): Promise<Source> {
  const local = staticFileUri(src);
  if (local !== undefined) {
    const uri = await local;
    if (uri === null) throw domError("NotSupportedError", `Zami: no static file ${src}`);
    return fileSource(uri);
  }
  if (src.startsWith("file:")) return fileSource(src);
  const data = /^data:[^,]*?(;base64)?,(.*)$/s.exec(src);
  if (data) {
    return decodable(
      data[1]
        ? base64Bytes(data[2])
        : (new TextEncoder().encode(decodeURIComponent(data[2])).buffer as ArrayBuffer),
    );
  }
  if (/^(?:https?|blob):/i.test(src)) {
    const response = await fetch(src);
    if (!response.ok) throw domError("NotSupportedError", `HTTP ${response.status} for ${src}`);
    return decodable(await response.arrayBuffer());
  }
  throw domError("NotSupportedError", `Zami: can't play ${src}`);
}

/** The context every <audio> plays through, suspended while none plays. */
let elementContext: ZamiAudioContext | null = null;
/** Playing elements: kept from collection, as a browser keeps them. */
const playingElements = new Set<ZamiAudio>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function sharedContext(): ZamiAudioContext {
  elementContext ??= new ZamiAudioContext();
  return elementContext;
}

function setPlaying(element: ZamiAudio, playing: boolean): void {
  if (playing) playingElements.add(element);
  else playingElements.delete(element);
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  if (playingElements.size > 0 || !elementContext) return;
  const context = elementContext;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (playingElements.size === 0 && context.state === "running")
      void context.suspend().catch(() => {});
  }, 3000);
}

type MediaListener = ((event: MediaEvent) => void) | { handleEvent(event: MediaEvent): void };

interface MediaEvent {
  type: string;
  target: ZamiAudio;
  currentTarget: ZamiAudio;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_DECODE = 3;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

class ZamiMediaError {
  static readonly MEDIA_ERR_ABORTED = MEDIA_ERR_ABORTED;
  static readonly MEDIA_ERR_NETWORK = MEDIA_ERR_NETWORK;
  static readonly MEDIA_ERR_DECODE = MEDIA_ERR_DECODE;
  static readonly MEDIA_ERR_SRC_NOT_SUPPORTED = MEDIA_ERR_SRC_NOT_SUPPORTED;
  constructor(
    readonly code: number,
    readonly message: string,
  ) {}
}

/** The `on…` handler properties an HTMLMediaElement has. */
const HANDLED_EVENTS = [
  "abort",
  "canplay",
  "canplaythrough",
  "durationchange",
  "emptied",
  "ended",
  "error",
  "loadeddata",
  "loadedmetadata",
  "loadstart",
  "pause",
  "play",
  "playing",
  "ratechange",
  "seeked",
  "seeking",
  "timeupdate",
  "volumechange",
  "waiting",
] as const;

type Handlers = {
  [K in (typeof HANDLED_EVENTS)[number] as `on${K}`]: ((event: MediaEvent) => unknown) | null;
};

/**
 * An HTMLAudioElement: `src`, `play()`/`pause()`, `currentTime`, `duration`, `volume`,
 * `muted`, `loop`, `playbackRate`, `autoplay`, and the media events, in a browser's
 * order. It plays a file source on a shared context; a source that can't be opened is a
 * MEDIA_ERR_SRC_NOT_SUPPORTED error, as an unplayable file is in a browser.
 */
class ZamiAudio {
  static readonly HAVE_NOTHING = 0;
  static readonly HAVE_METADATA = 1;
  static readonly HAVE_CURRENT_DATA = 2;
  static readonly HAVE_FUTURE_DATA = 3;
  static readonly HAVE_ENOUGH_DATA = 4;
  static readonly NETWORK_EMPTY = 0;
  static readonly NETWORK_IDLE = 1;
  static readonly NETWORK_LOADING = 2;
  static readonly NETWORK_NO_SOURCE = 3;

  readonly tagName = "AUDIO";
  readonly nodeName = "AUDIO";
  readyState = 0;
  networkState = 0;
  error: ZamiMediaError | null = null;
  preload = "auto";
  autoplay = false;
  controls = false;
  crossOrigin: string | null = null;
  preservesPitch = true;
  defaultPlaybackRate = 1;
  defaultMuted = false;
  srcObject: unknown = null;
  readonly style: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};

  #src = "";
  #generation = 0;
  #source: Source | null = null;
  #native: NativeFileSource | null = null;
  #node: AudioApi.AudioScheduledSourceNode | null = null;
  #subscriptions: [name: string, id: string][] = [];
  #duration = Number.NaN;
  /** The position while there's no node to ask, or a seek it hasn't reached yet. */
  #position = 0;
  #seeking = false;
  #paused = true;
  #ended = false;
  #volume = 1;
  #muted = false;
  #loop = false;
  #rate = 1;
  #pendingPlays: { resolve: () => void; reject: (error: Error) => void }[] = [];
  #listeners = new Map<string, { listener: MediaListener; once: boolean }[]>();
  #events: string[] = [];

  constructor(src?: string) {
    for (const type of HANDLED_EVENTS) (this as unknown as Handlers)[`on${type}`] = null;
    if (src !== undefined) this.src = src;
  }

  // --- Attributes ---

  get src(): string {
    return this.#src;
  }

  set src(value: string) {
    this.#src = String(value ?? "");
    this.load();
  }

  get currentSrc(): string {
    return this.#source === null ? "" : this.#src;
  }

  getAttribute(name: string): string | null {
    if (name === "src") return this.#src || null;
    if (name === "preload") return this.preload;
    return null;
  }

  setAttribute(name: string, value: string): void {
    if (name === "src") this.src = value;
    else if (name === "preload") this.preload = value;
    else if (name === "loop") this.loop = true;
    else if (name === "muted") this.muted = true;
    else if (name === "autoplay") this.autoplay = true;
  }

  removeAttribute(name: string): void {
    // Only clears it: a browser waits for `load()` to drop the playing source.
    if (name === "src") this.#src = "";
    else if (name === "loop") this.loop = false;
    else if (name === "muted") this.muted = false;
    else if (name === "autoplay") this.autoplay = false;
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }

  get paused(): boolean {
    return this.#paused;
  }

  get ended(): boolean {
    return this.#ended && !this.#loop;
  }

  get seeking(): boolean {
    return this.#seeking;
  }

  get duration(): number {
    return this.#duration;
  }

  get currentTime(): number {
    if (this.#ended) return this.#duration;
    if (this.#native && !this.#seeking) return this.#native.currentTime;
    return this.#position;
  }

  set currentTime(value: number) {
    let time = Math.max(0, Number(value) || 0);
    if (Number.isFinite(this.#duration)) time = Math.min(time, this.#duration);
    this.#position = time;
    this.#ended = false;
    if (!this.#native) return;
    this.#seeking = true;
    this.#native.seekToTime(time);
    this.#fire("seeking");
    this.#fire("timeupdate");
    // The seek lands on the decoder's thread; from the next position report, the node
    // knows where it is.
    this.#fire("seeked");
  }

  get volume(): number {
    return this.#volume;
  }

  set volume(value: number) {
    if (!(value >= 0 && value <= 1))
      throw domError("IndexSizeError", `The volume provided (${value}) is outside [0, 1]`);
    if (value === this.#volume) return;
    this.#volume = value;
    this.#applyVolume();
    this.#fire("volumechange");
  }

  get muted(): boolean {
    return this.#muted;
  }

  set muted(value: boolean) {
    if (Boolean(value) === this.#muted) return;
    this.#muted = Boolean(value);
    this.#applyVolume();
    this.#fire("volumechange");
  }

  get loop(): boolean {
    return this.#loop;
  }

  set loop(value: boolean) {
    this.#loop = Boolean(value);
    if (this.#native) this.#native.loop = this.#loop;
  }

  get playbackRate(): number {
    return this.#rate;
  }

  set playbackRate(value: number) {
    const rate = Math.min(4, Math.max(0, Number(value) || 0));
    if (rate === this.#rate) return;
    this.#rate = rate;
    if (this.#native) this.#native.playbackRate = rate;
    this.#fire("ratechange");
  }

  get buffered(): { length: number; start(i: number): number; end(i: number): number } {
    const loaded = this.#native !== null && Number.isFinite(this.#duration);
    return {
      length: loaded ? 1 : 0,
      start: () => 0,
      end: () => this.#duration,
    };
  }

  canPlayType(type: string): "" | "maybe" | "probably" {
    const base = type.toLowerCase().split(";")[0].trim();
    return /^audio\/(?:mpeg|mp3|mp4|x-m4a|aac|ogg|opus|webm|wav|x-wav|wave|flac|x-flac|aiff|x-aiff)$/.test(
      base,
    )
      ? "maybe"
      : "";
  }

  // --- Playback ---

  load(): void {
    const generation = ++this.#generation;
    const hadSource = this.#source !== null || this.networkState !== ZamiAudio.NETWORK_EMPTY;
    this.#rejectPlays(
      domError("AbortError", "The play() request was interrupted by a new load request."),
    );
    this.#teardown();
    this.#source = null;
    this.#duration = Number.NaN;
    this.#position = 0;
    this.#ended = false;
    this.error = null;
    this.readyState = ZamiAudio.HAVE_NOTHING;
    if (hadSource) this.#fire("emptied");
    if (!this.#paused) {
      this.#paused = true;
      setPlaying(this, false);
      this.#fire("pause");
    }
    if (this.#src === "") {
      this.networkState = ZamiAudio.NETWORK_EMPTY;
      return;
    }
    this.networkState = ZamiAudio.NETWORK_LOADING;
    this.#fire("loadstart");
    void this.#open(generation);
  }

  async #open(generation: number): Promise<void> {
    try {
      const source = await resolveSource(this.#src);
      if (generation !== this.#generation) return;
      this.#source = source;
      this.#spawn();
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#fail(String((error as Error)?.message ?? error));
      return;
    }
    this.networkState = ZamiAudio.NETWORK_IDLE;
    this.readyState = ZamiAudio.HAVE_ENOUGH_DATA;
    this.#fire("durationchange");
    this.#fire("loadedmetadata");
    this.#fire("loadeddata");
    this.#fire("canplay");
    this.#fire("canplaythrough");
    if (this.#position > 0) this.#native?.seekToTime(this.#position);
    if (!this.#paused) this.#start();
    else if (this.autoplay) void this.play().catch(() => {});
  }

  #fail(message: string): void {
    this.error = new ZamiMediaError(MEDIA_ERR_SRC_NOT_SUPPORTED, message);
    this.networkState = ZamiAudio.NETWORK_NO_SOURCE;
    this.#fire("error");
    this.#rejectPlays(domError("NotSupportedError", "The element has no supported sources."));
    if (!this.#paused) {
      this.#paused = true;
      setPlaying(this, false);
    }
  }

  /** A file source for the current source, at the start. */
  #spawn(): void {
    this.#teardown();
    if (this.#source === null) return;
    const context = sharedContext();
    const native = (
      context.context as unknown as { createFileSource(options: object): NativeFileSource | null }
    ).createFileSource({
      source: this.#source,
      loop: this.#loop,
      volume: this.#muted ? 0 : this.#volume,
      playbackRate: this.#rate,
      preservesPitch: this.preservesPitch,
    });
    // A source the decoders can't open makes a node with no duration that plays nothing.
    if (!native || !(native.duration > 0)) throw new Error("Zami: unsupported or invalid audio");
    const node = new AudioApi.AudioScheduledSourceNode(context as never, native as never);
    node.connect(context.destination);
    const events = emitter();
    const ended = events.addAudioEventListener("ended", () => this.#onEnded(native));
    const position = events.addAudioEventListener("positionChanged", () => {
      if (this.#native !== native) return;
      this.#seeking = false;
      this.#fire("timeupdate");
    });
    native.onended = ended;
    native.onpositionchanged = position;
    this.#subscriptions = [
      ["ended", ended],
      ["positionChanged", position],
    ];
    this.#native = native;
    this.#node = node;
    this.#duration = native.duration;
  }

  #teardown(): void {
    const native = this.#native;
    this.#native = null;
    this.#seeking = false;
    if (!native) return;
    const events = emitter();
    for (const [name, id] of this.#subscriptions) events.removeAudioEventListener(name, id);
    this.#subscriptions = [];
    native.onended = "0";
    native.onpositionchanged = "0";
    try {
      native.pause();
      this.#node?.disconnect();
    } catch {
      /* already gone */
    }
    this.#node = null;
  }

  #onEnded(native: NativeFileSource): void {
    if (this.#native !== native || this.#loop) return;
    // A finished source doesn't start again: the next play gets a new one.
    try {
      this.#spawn();
    } catch {
      this.#native = null;
    }
    this.#ended = true;
    this.#position = 0;
    this.#paused = true;
    setPlaying(this, false);
    this.#fire("timeupdate");
    this.#fire("pause");
    this.#fire("ended");
  }

  play(): Promise<void> {
    if (this.error) {
      return Promise.reject(domError("NotSupportedError", "The element has no supported sources."));
    }
    if (this.#src === "" && this.#source === null) {
      return Promise.reject(domError("NotSupportedError", "The element has no source."));
    }
    const played = new Promise<void>((resolve, reject) => {
      this.#pendingPlays.push({ resolve, reject });
    });
    if (this.#ended) {
      this.#ended = false;
      this.#position = 0;
    }
    if (this.#paused) {
      this.#paused = false;
      setPlaying(this, true);
      this.#fire("play");
    }
    if (this.#native) this.#start();
    else if (this.networkState === ZamiAudio.NETWORK_EMPTY) this.load();
    return played;
  }

  #start(): void {
    const native = this.#native;
    if (!native) return;
    const context = sharedContext();
    native.start(context.currentTime);
    // What a source's start() does: resume the context it plays on.
    (context as unknown as { markRunningOnSourceStart(): void }).markRunningOnSourceStart();
    this.#fire("playing");
    const plays = this.#pendingPlays;
    this.#pendingPlays = [];
    for (const play of plays) play.resolve();
  }

  pause(): void {
    this.#rejectPlays(
      domError("AbortError", "The play() request was interrupted by a call to pause()."),
    );
    if (this.#paused) return;
    if (this.#native) {
      this.#position = this.#native.currentTime;
      this.#native.pause();
    }
    this.#paused = true;
    setPlaying(this, false);
    this.#fire("timeupdate");
    this.#fire("pause");
  }

  fastSeek(time: number): void {
    this.currentTime = time;
  }

  #rejectPlays(error: Error): void {
    const plays = this.#pendingPlays;
    this.#pendingPlays = [];
    for (const play of plays) play.reject(error);
  }

  #applyVolume(): void {
    if (this.#native) this.#native.volume = this.#muted ? 0 : this.#volume;
  }

  // --- Events ---

  addEventListener(
    type: string,
    listener: MediaListener | null,
    options?: boolean | { once?: boolean },
  ): void {
    if (!listener) return;
    const list = this.#listeners.get(type) ?? [];
    if (list.some((entry) => entry.listener === listener)) return;
    list.push({ listener, once: typeof options === "object" && options.once === true });
    this.#listeners.set(type, list);
  }

  removeEventListener(type: string, listener: MediaListener | null): void {
    const list = this.#listeners.get(type);
    if (!list) return;
    this.#listeners.set(
      type,
      list.filter((entry) => entry.listener !== listener),
    );
  }

  dispatchEvent(event: { type: string }): boolean {
    this.#dispatch(event.type);
    return true;
  }

  /** Queues an event: like a browser's, it fires after the code that caused it. */
  #fire(type: string): void {
    this.#events.push(type);
    if (this.#events.length === 1) queueMicrotask(() => this.#flushEvents());
  }

  #flushEvents(): void {
    // Each event's listeners may queue more; they fire in order, after it.
    for (let i = 0; i < this.#events.length; i++) this.#dispatch(this.#events[i]);
    this.#events = [];
  }

  #dispatch(type: string): void {
    const event: MediaEvent = {
      type,
      target: this,
      currentTarget: this,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {},
    };
    const call = (listener: MediaListener) => {
      try {
        if (typeof listener === "function") listener.call(this, event);
        else listener.handleEvent(event);
      } catch (error) {
        console.error(`[zami] audio "${type}" listener failed`, error);
      }
    };
    const handler = (this as unknown as Record<string, unknown>)[`on${type}`];
    if (typeof handler === "function") call(handler as MediaListener);
    const list = this.#listeners.get(type);
    if (!list) return;
    // A copy: a `once` listener leaves the list as it runs.
    for (const entry of list.slice()) {
      if (entry.once) this.removeEventListener(type, entry.listener);
      call(entry.listener);
    }
  }

  // --- Element ---

  remove(): void {}

  cloneNode(): ZamiAudio {
    const clone = new ZamiAudio();
    clone.preload = this.preload;
    clone.loop = this.loop;
    clone.muted = this.muted;
    clone.volume = this.volume;
    if (this.#src) clone.src = this.#src;
    return clone;
  }
}

// --- WebCodecs (Opus) ---

interface AudioDecoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: ArrayBuffer | ArrayBufferView;
}

class ZamiEncodedAudioChunk {
  readonly type: "key" | "delta";
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  readonly data: Uint8Array;

  constructor(init: {
    type: "key" | "delta";
    timestamp: number;
    duration?: number;
    data: ArrayBuffer | ArrayBufferView;
  }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration ?? null;
    const view = ArrayBuffer.isView(init.data)
      ? new Uint8Array(init.data.buffer, init.data.byteOffset, init.data.byteLength)
      : new Uint8Array(init.data);
    this.data = view.slice();
    this.byteLength = this.data.length;
  }

  copyTo(destination: ArrayBuffer | ArrayBufferView): void {
    const target = ArrayBuffer.isView(destination)
      ? new Uint8Array(destination.buffer, destination.byteOffset, destination.byteLength)
      : new Uint8Array(destination);
    target.set(this.data);
  }
}

/** WebCodecs' AudioData, f32-planar, over a decoded AudioBuffer. */
class ZamiAudioData {
  readonly format = "f32-planar";
  readonly sampleRate: number;
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  readonly duration: number;
  #buffer: ApiAudioBuffer | null;

  constructor(
    buffer: ApiAudioBuffer,
    readonly timestamp: number,
  ) {
    this.#buffer = buffer;
    this.sampleRate = buffer.sampleRate;
    this.numberOfFrames = buffer.length;
    this.numberOfChannels = buffer.numberOfChannels;
    this.duration = (buffer.length / buffer.sampleRate) * 1e6;
  }

  allocationSize({
    frameCount,
    frameOffset = 0,
  }: { frameCount?: number; frameOffset?: number } = {}): number {
    return (frameCount ?? this.numberOfFrames - frameOffset) * 4;
  }

  copyTo(
    destination: Float32Array,
    {
      planeIndex,
      frameOffset = 0,
      frameCount,
    }: { planeIndex: number; frameOffset?: number; frameCount?: number; format?: string },
  ): void {
    if (!this.#buffer) throw domError("InvalidStateError", "AudioData is closed");
    const plane = this.#buffer.getChannelData(planeIndex);
    destination.set(
      plane.subarray(frameOffset, frameOffset + (frameCount ?? plane.length - frameOffset)),
    );
  }

  clone(): ZamiAudioData {
    if (!this.#buffer) throw domError("InvalidStateError", "AudioData is closed");
    return new ZamiAudioData(this.#buffer, this.timestamp);
  }

  close(): void {
    this.#buffer = null;
  }
}

/**
 * WebCodecs' AudioDecoder, for Opus: the packets queue up, and `flush()` decodes them as
 * one Ogg Opus stream (iOS decodes Opus in Ogg, not bare packets) into one AudioData.
 */
class ZamiAudioDecoder {
  state: "unconfigured" | "configured" | "closed" = "unconfigured";
  decodeQueueSize = 0;
  #output: (data: ZamiAudioData) => void;
  #error: (error: Error) => void;
  #config: AudioDecoderConfig | null = null;
  #packets: Uint8Array[] = [];
  #timestamp = 0;

  constructor(init: { output: (data: ZamiAudioData) => void; error: (error: Error) => void }) {
    this.#output = init.output;
    this.#error = init.error;
  }

  static isConfigSupported(
    config: AudioDecoderConfig,
  ): Promise<{ supported: boolean; config: AudioDecoderConfig }> {
    return Promise.resolve({ supported: config.codec === "opus", config });
  }

  configure(config: AudioDecoderConfig): void {
    if (this.state === "closed") throw domError("InvalidStateError", "The decoder is closed");
    if (config.codec !== "opus") {
      this.close();
      throw domError(
        "NotSupportedError",
        `Zami: AudioDecoder decodes Opus only, not ${config.codec}`,
      );
    }
    this.#config = config;
    this.state = "configured";
  }

  decode(chunk: ZamiEncodedAudioChunk): void {
    if (this.state !== "configured")
      throw domError("InvalidStateError", "The decoder isn't configured");
    if (this.#packets.length === 0) this.#timestamp = chunk.timestamp;
    this.#packets.push(chunk.data);
  }

  async flush(): Promise<void> {
    const config = this.#config;
    if (this.state !== "configured" || !config)
      throw domError("InvalidStateError", "The decoder isn't configured");
    const packets = this.#packets;
    this.#packets = [];
    if (packets.length === 0) return;
    const description = config.description;
    const head =
      description && description.byteLength >= 19
        ? new Uint8Array(
            ArrayBuffer.isView(description)
              ? description.buffer.slice(
                  description.byteOffset,
                  description.byteOffset + description.byteLength,
                )
              : description,
          )
        : opusHead({ channels: config.numberOfChannels, inputSampleRate: config.sampleRate });
    try {
      const buffer = await AudioApi.decodeAudioData(
        oggOpus(head, packets).buffer,
        config.sampleRate,
      );
      this.#output(new ZamiAudioData(buffer, this.#timestamp));
    } catch (error) {
      const failure = domError("EncodingError", `Zami: couldn't decode Opus: ${String(error)}`);
      this.close();
      this.#error(failure);
      throw failure;
    }
  }

  reset(): void {
    this.#packets = [];
    this.#config = null;
    if (this.state !== "closed") this.state = "unconfigured";
  }

  close(): void {
    this.#packets = [];
    this.state = "closed";
  }
}

export const audioGlobals: Record<string, unknown> = {
  AudioContext: ZamiAudioContext,
  webkitAudioContext: ZamiAudioContext,
  OfflineAudioContext: ZamiOfflineAudioContext,
  Audio: ZamiAudio,
  MediaError: ZamiMediaError,
  AudioDecoder: ZamiAudioDecoder,
  EncodedAudioChunk: ZamiEncodedAudioChunk,
  AudioData: ZamiAudioData,
};

// In development, what plays (for the debugger): `__zamiAudioDebug.playing()` and
// `.contexts()`.
if (__DEV__) {
  (globalThis as Record<string, unknown>).__zamiAudioDebug = {
    playing: () =>
      [...playingElements].map((element) => ({
        src: element.currentSrc,
        currentTime: element.currentTime,
        duration: element.duration,
        paused: element.paused,
      })),
    contexts: () =>
      recentContexts.map((context) => ({
        state: context.state,
        currentTime: context.currentTime,
        elements: context === elementContext,
      })),
  };
}
