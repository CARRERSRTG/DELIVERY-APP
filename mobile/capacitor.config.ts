import type { CapacitorConfig } from "@capacitor/cli";

// ============================================================
// RDZ Deliveries — Android shell for drivers.
//
// The app is NOT bundled into the APK. The shell loads the live site, so a
// deploy reaches every driver's phone immediately with no reinstall. The only
// native part is background GPS: Android will not let a web page report
// position with the screen off, which is exactly what a driver's phone does
// all day in a truck.
// ============================================================

const config: CapacitorConfig = {
  appId: "net.rdztilegroup.deliveries",
  appName: "RDZ Deliveries",
  // Capacitor requires a webDir even when loading a remote URL; this holds
  // only the offline fallback page.
  webDir: "www",
  server: {
    url: "https://deliveries-app-rtg2.vercel.app",
    // The site is HTTPS-only; no cleartext traffic is permitted.
    cleartext: false,
    androidScheme: "https",
  },
  android: {
    // Keep the driver inside the app: links open in the shell, not a browser
    // tab that would lose their session.
    allowMixedContent: false,
  },
  plugins: {
    BackgroundGeolocation: {},
  },
};

export default config;
