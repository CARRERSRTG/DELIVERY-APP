// ============================================================
// Bridge to the Android shell (Capacitor).
//
// The same web app runs in three places: a desktop browser, a phone browser,
// and inside the driver APK. Only the last one can report position with the
// screen off, so the app asks here whether the native bridge is present and
// degrades to the browser's own geolocation when it isn't.
//
// Nothing from Capacitor is bundled into the web build — the shell injects
// `window.Capacitor` into the WebView at runtime. That's what keeps the web
// deploy independent of the APK.
// ============================================================

/** One position fix, normalised to the shape the app stores. */
export interface NativeFix {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  heading: number | null;
  recorded_at: string;
}

interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (position: RawPosition | undefined, error?: { code?: string; message?: string }) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

interface RawPosition {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  bearing?: number | null;
  time?: number | null;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: { BackgroundGeolocation?: BackgroundGeolocationPlugin };
}

function capacitor(): CapacitorGlobal | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor ?? null;
}

/** True when running inside the driver APK rather than a browser. */
export function isNativeApp(): boolean {
  const c = capacitor();
  return !!c && (c.isNativePlatform?.() ?? false);
}

/** The background-location plugin, or null in a plain browser. */
export function backgroundGeolocation(): BackgroundGeolocationPlugin | null {
  return capacitor()?.Plugins?.BackgroundGeolocation ?? null;
}

/**
 * Start reporting position from the native foreground service. Android shows
 * a permanent notification for the whole time this runs, so the driver can
 * always see that sharing is on — and it is torn down on clock-out.
 *
 * Returns a stop function, or null if there's no native bridge.
 */
export async function startNativeWatch(
  onFix: (fix: NativeFix) => void,
  onError: (message: string, denied: boolean) => void,
  labels: { title: string; message: string },
  distanceFilterM = 40,
): Promise<(() => void) | null> {
  const plugin = backgroundGeolocation();
  if (!plugin) return null;

  let watcherId: string | null = null;
  let stopped = false;

  try {
    watcherId = await plugin.addWatcher(
      {
        backgroundTitle: labels.title,
        backgroundMessage: labels.message,
        requestPermissions: true,
        // Skip the cached last-known fix — on a truck that's often the depot
        // from hours ago, which would put the driver in the wrong place.
        stale: false,
        distanceFilter: distanceFilterM,
      },
      (position, error) => {
        if (stopped) return;
        if (error) {
          onError(error.message || "Location error", error.code === "NOT_AUTHORIZED");
          return;
        }
        if (!position) return;
        onFix({
          lat: position.latitude,
          lng: position.longitude,
          accuracy_m: position.accuracy ?? null,
          speed_mps: position.speed ?? null,
          heading: position.bearing ?? null,
          recorded_at: new Date(position.time ?? Date.now()).toISOString(),
        });
      },
    );
  } catch (e) {
    onError(e instanceof Error ? e.message : "Could not start location sharing", false);
    return null;
  }

  return () => {
    stopped = true;
    if (watcherId) void plugin.removeWatcher({ id: watcherId }).catch(() => { /* shutting down */ });
  };
}

/** Open the OS settings page, so a driver who denied the permission can fix it. */
export async function openLocationSettings(): Promise<void> {
  await backgroundGeolocation()?.openSettings().catch(() => { /* not fatal */ });
}
