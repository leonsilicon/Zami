// `navigator.geolocation` on expo-location, for Zam's location sharing (a one-off
// position and live location's `watchPosition`).
import * as Location from "expo-location";

type PositionCallback = (position: GeolocationPosition) => void;
type ErrorCallback = ((error: GeolocationPositionError) => void) | null | undefined;

const PERMISSION_DENIED = 1;
const POSITION_UNAVAILABLE = 2;
const TIMEOUT = 3;

function positionError(code: number, message: string): GeolocationPositionError {
  return {
    code,
    message,
    PERMISSION_DENIED,
    POSITION_UNAVAILABLE,
    TIMEOUT,
  } as GeolocationPositionError;
}

function toPosition(location: Location.LocationObject): GeolocationPosition {
  const { coords, timestamp } = location;
  return {
    coords: {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy ?? 0,
      altitude: coords.altitude,
      altitudeAccuracy: coords.altitudeAccuracy,
      heading: coords.heading,
      speed: coords.speed,
    },
    timestamp,
  } as GeolocationPosition;
}

const accuracy = (options?: PositionOptions) =>
  options?.enableHighAccuracy ? Location.Accuracy.High : Location.Accuracy.Balanced;

async function permitted(error: ErrorCallback): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status === "granted") return true;
  error?.(positionError(PERMISSION_DENIED, "Location permission denied"));
  return false;
}

const watches = new Map<number, Promise<Location.LocationSubscription | null>>();
let nextWatchId = 1;

export const geolocation = {
  getCurrentPosition(success: PositionCallback, error?: ErrorCallback, options?: PositionOptions) {
    void (async () => {
      if (!(await permitted(error))) return;
      const timeout = options?.timeout;
      const position = Location.getCurrentPositionAsync({ accuracy: accuracy(options) });
      const timer =
        timeout !== undefined && Number.isFinite(timeout)
          ? new Promise<never>((_, reject) =>
              setTimeout(() => reject(positionError(TIMEOUT, "Timed out")), timeout),
            )
          : null;
      try {
        success(toPosition(await (timer ? Promise.race([position, timer]) : position)));
      } catch (caught) {
        error?.(
          typeof caught === "object" && caught !== null && "code" in caught
            ? (caught as GeolocationPositionError)
            : positionError(POSITION_UNAVAILABLE, String(caught)),
        );
      }
    })();
  },
  watchPosition(
    success: PositionCallback,
    error?: ErrorCallback,
    options?: PositionOptions,
  ): number {
    const id = nextWatchId++;
    watches.set(
      id,
      (async () => {
        if (!(await permitted(error))) return null;
        try {
          return await Location.watchPositionAsync(
            { accuracy: accuracy(options), distanceInterval: 5 },
            (location) => success(toPosition(location)),
          );
        } catch (caught) {
          error?.(positionError(POSITION_UNAVAILABLE, String(caught)));
          return null;
        }
      })(),
    );
    return id;
  },
  clearWatch(id: number): void {
    const watch = watches.get(id);
    watches.delete(id);
    void watch?.then((subscription) => subscription?.remove());
  },
};
