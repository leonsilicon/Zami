import {
  createVideoPlayer,
  useVideoPlayer,
  VideoView,
  type VideoPlayer,
  type VideoSource,
  type VideoThumbnail,
} from "expo-video";
import { useEffect, useEffectEvent, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Image, mediaSource } from "#image";

/** A `use:` action on a media element, such as Zam's `rememberVolume`. */
export type MediaAction = (element: HTMLMediaElement) => { destroy?: () => void } | void;

/** The player's source for a `src` URL, with the request headers `mediaSource` gives it. */
function videoSource(url: string): VideoSource {
  const headers = mediaSource(url)?.headers;
  return headers ? { uri: url, headers } : { uri: url };
}

/**
 * The player as the `HTMLMediaElement` a `use:` action reads: its `volume` and `muted`,
 * and `volumechange` (the player's volume or mute changed).
 */
function mediaElement(player: VideoPlayer): HTMLMediaElement {
  const subscriptions: { remove(): void }[] = [];
  return {
    get volume() {
      return player.volume;
    },
    set volume(volume: number) {
      player.volume = volume;
    },
    get muted() {
      return player.muted;
    },
    set muted(muted: boolean) {
      player.muted = muted;
    },
    addEventListener(type: string, listener: () => void) {
      if (type !== "volumechange") return;
      subscriptions.push(
        player.addListener("volumeChange", listener),
        player.addListener("mutedChange", listener),
      );
    },
    removeEventListener() {
      for (const subscription of subscriptions.splice(0)) subscription.remove();
    },
  } as unknown as HTMLMediaElement;
}

export interface VideoProps {
  /**
   * `src`. An authenticated Matrix media URL is requested with the account's token, as
   * `mediaSource` adds it for images. Without one it's an empty box.
   */
  src: string | null | undefined;
  /** `poster`: a URL, or a frame `videoFrameThumbnail` grabbed, over the player until its first frame. */
  poster?: string | VideoThumbnail | null;
  controls?: boolean;
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
  /** A `use:` action on the element (`use={rememberVolume}`), given the player as one. */
  use?: MediaAction;
  /** The element's classes, on the box the player fills (object-contain). */
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** `onloadedmetadata`: the source has loaded. The player seeks through `currentTime`. */
  onLoadedMetadata?: (player: VideoPlayer) => void;
  /** Its `videoWidth` and `videoHeight`, once its video track is known and when it changes. */
  onResize?: (videoWidth: number, videoHeight: number) => void;
  /** `oncanplay`: the player is ready to play. */
  onCanPlay?: () => void;
  /** `onerror`: the source failed to load or play. */
  onError?: () => void;
}

/**
 * A `<video>`: an expo-video player for `src`, filling the box `className` and `style`
 * lay out, with `poster` over it until its first frame. A new `src` gets a new player.
 * With `controls`, a touch on it is the player's, not an enclosing `Pressable`'s; without,
 * it takes no touches, as a video with no controls can't be paused or seeked.
 */
export function Video({
  src,
  poster,
  controls = false,
  className = "",
  style,
  ...props
}: VideoProps): ReactNode {
  // The source whose first frame is on screen: the poster shows until it's this `src`.
  const [shown, setShown] = useState<string | null>(null);
  return (
    <View
      className={`overflow-hidden ${className}`}
      style={style}
      pointerEvents={controls ? "auto" : "none"}
      onStartShouldSetResponder={() => controls}
    >
      {src ? (
        <Player
          key={src}
          src={src}
          controls={controls}
          onFirstFrame={() => setShown(src)}
          {...props}
        />
      ) : null}
      {poster && shown !== src ? (
        <Image
          source={typeof poster === "string" ? mediaSource(poster) : poster}
          accessible={false}
          pointerEvents="none"
          contentFit="contain"
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </View>
  );
}

interface PlayerProps extends Omit<VideoProps, "src" | "poster" | "className" | "style"> {
  src: string;
  onFirstFrame: () => void;
}

/** One player for one source. */
function Player({
  src,
  controls = false,
  autoplay = false,
  muted = false,
  loop = false,
  use,
  onLoadedMetadata,
  onResize,
  onCanPlay,
  onError,
  onFirstFrame,
}: PlayerProps): ReactNode {
  const source = useMemo(() => videoSource(src), [src]);
  const player = useVideoPlayer(source, (p) => {
    p.muted = muted;
    p.loop = loop;
    if (autoplay) p.play();
  });
  useEffect(() => {
    if (!use) return;
    return use(mediaElement(player))?.destroy;
  }, [player, use]);
  const loaded = useEffectEvent(() => onLoadedMetadata?.(player));
  const resized = useEffectEvent((width: number, height: number) => onResize?.(width, height));
  const canPlay = useEffectEvent(() => onCanPlay?.());
  const failed = useEffectEvent(() => onError?.());
  useEffect(() => {
    const subscriptions = [
      player.addListener("statusChange", ({ status }) => {
        if (status === "readyToPlay") canPlay();
        else if (status === "error") failed();
      }),
      player.addListener("sourceLoad", ({ availableVideoTracks }) => {
        loaded();
        const size = availableVideoTracks[0]?.size;
        if (size) resized(size.width, size.height);
      }),
      player.addListener("videoTrackChange", ({ videoTrack }) => {
        if (videoTrack) resized(videoTrack.size.width, videoTrack.size.height);
      }),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, [player]);
  return (
    <VideoView
      player={player}
      nativeControls={controls}
      contentFit="contain"
      onFirstFrameRender={onFirstFrame}
      style={StyleSheet.absoluteFill}
    />
  );
}

// Upstream's videoFrameUrl draws a video's first frame through a <video> and a <canvas>.
// expo-video grabs it natively instead: a player made for the source is asked, once it
// has loaded, for the frame at 0 s fitted in the box, and released. Cached like
// videoFrameUrl's frames (the latest 50, by box and URL), so a row mounted again shows it
// at once.
const FRAMES_MAX = 50;
const FRAME_TIMEOUT_MS = 15_000;
const frames = new Map<string, Promise<VideoThumbnail | null>>();

/**
 * Upstream's `videoFrameUrl(src, maxW, maxH)`: the first frame of the video at `src`,
 * fitted in a `maxW`×`maxH` box, as an image source (`Image`'s, or `Video`'s `poster`), or
 * null if it can't be had (it fails to load, or nothing within 15 s). The player that grabs
 * it is released as soon as it has.
 */
export function videoFrameThumbnail(
  src: string,
  maxW: number,
  maxH: number,
): Promise<VideoThumbnail | null> {
  const key = `${maxW}x${maxH} ${src}`;
  const known = frames.get(key);
  if (known) {
    frames.delete(key);
    frames.set(key, known);
    return known;
  }
  const player = createVideoPlayer(videoSource(src));
  player.muted = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = Promise.race([
    new Promise<void>((resolve, reject) => {
      if (player.status === "readyToPlay") return resolve();
      const subscription = player.addListener("statusChange", ({ status }) => {
        if (status === "readyToPlay") {
          subscription.remove();
          resolve();
        } else if (status === "error") {
          subscription.remove();
          reject(new Error("video failed to load"));
        }
      });
    })
      .then(() => player.generateThumbnailsAsync(0, { maxWidth: maxW, maxHeight: maxH }))
      .then((thumbnails) => thumbnails[0] ?? null),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), FRAME_TIMEOUT_MS);
    }),
  ])
    .catch(() => null)
    .then((thumbnail) => {
      clearTimeout(timer);
      player.release();
      // Only a frame is remembered; a failure is tried again next time.
      if (!thumbnail) frames.delete(key);
      return thumbnail;
    });
  if (frames.size >= FRAMES_MAX) frames.delete(frames.keys().next().value!);
  frames.set(key, frame);
  return frame;
}
