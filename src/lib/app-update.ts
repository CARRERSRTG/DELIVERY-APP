// ============================================================
// In-app update check for the driver APK.
//
// The shell loads the live site, so day-to-day changes (screens, pricing,
// routing) reach every phone the moment they deploy — no update needed. Only
// a NATIVE change (permissions, icon, GPS plugin) needs a new APK, and that's
// what this prompts for.
//
// The shell stamps its build number into the WebView's user agent
// (see mobile/capacitor.config.ts). No plugin, and it's readable on the very
// first render.
// ============================================================

/** Build number of the newest published APK. Bump this together with
 * `versionCode` in mobile/android/app/build.gradle and `appendUserAgent` in
 * mobile/capacitor.config.ts whenever a new APK is released. */
export const LATEST_APK_VERSION_CODE = 1;

/** Where the newest APK can be downloaded. Android's download manager handles
 * the install prompt, so the app itself needs no install permission. */
export const APK_DOWNLOAD_URL =
  "https://iwhcsvgujydebdyllcqu.supabase.co/storage/v1/object/public/app/RDZ-Deliveries.apk";

/**
 * The APK build this page is running inside, or null in a normal browser.
 * Matches the "RDZDeliveries/<n>" tag the shell appends to the user agent.
 */
export function installedApkVersion(userAgent: string | null | undefined): number | null {
  const m = /RDZDeliveries\/(\d+)/.exec(userAgent ?? "");
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Should this device be offered an update?
 *
 * Only inside the APK, and only when the published build is genuinely newer.
 * A browser gets nothing (there's nothing to install), and a phone running a
 * build NEWER than the constant is left alone rather than told to downgrade —
 * that happens while testing a build before its release is published.
 */
export function updateAvailable(
  userAgent: string | null | undefined,
  latest: number = LATEST_APK_VERSION_CODE,
): boolean {
  const installed = installedApkVersion(userAgent);
  return installed != null && installed < latest;
}
