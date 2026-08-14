import { describe, expect, it } from "vitest";
import { installedApkVersion, safeToReload, updateAvailable, webUpdateAvailable } from "./app-update";

const APK = (n: number) =>
  `Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 RDZDeliveries/${n}`;
const CHROME = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36";

describe("installedApkVersion", () => {
  it("reads the build number the shell stamps on the user agent", () => {
    expect(installedApkVersion(APK(3))).toBe(3);
  });

  it("returns null in a plain browser", () => {
    expect(installedApkVersion(CHROME)).toBeNull();
    expect(installedApkVersion("")).toBeNull();
    expect(installedApkVersion(null)).toBeNull();
    expect(installedApkVersion(undefined)).toBeNull();
  });
});

describe("updateAvailable", () => {
  it("offers an update when the published build is newer", () => {
    expect(updateAvailable(APK(1), 2)).toBe(true);
  });

  it("stays quiet when the phone is already current", () => {
    expect(updateAvailable(APK(2), 2)).toBe(false);
  });

  it("never prompts a browser — there is nothing to install", () => {
    expect(updateAvailable(CHROME, 99)).toBe(false);
  });

  it("does not tell a newer test build to downgrade", () => {
    // Happens while a build is on a phone before its release is published.
    expect(updateAvailable(APK(5), 2)).toBe(false);
  });
});

// ---- Web update detection ---------------------------------------------------
describe("webUpdateAvailable", () => {
  it("spots a newer deploy", () => {
    expect(webUpdateAvailable("1.3.3", "1.3.4")).toBe(true);
  });

  it("says nothing when the page is current", () => {
    expect(webUpdateAvailable("1.3.4", "1.3.4")).toBe(false);
    expect(webUpdateAvailable("1.3.4", " 1.3.4 ")).toBe(false);   // whitespace is not a release
  });

  it("also picks up a rollback", () => {
    // A rollback is a change the page must take, not one to ignore because
    // the number went down.
    expect(webUpdateAvailable("1.3.4", "1.3.3")).toBe(true);
  });

  it("stays quiet when the server can't be read", () => {
    // A failing check that nags on every poll would train drivers to ignore it.
    expect(webUpdateAvailable("1.3.4", null)).toBe(false);
    expect(webUpdateAvailable("1.3.4", undefined)).toBe(false);
    expect(webUpdateAvailable("1.3.4", "")).toBe(false);
  });
});

describe("safeToReload", () => {
  const doc = (match: string | null) => ({ querySelector: (sel: string) => (match === sel ? ({} as Element) : null) });

  it("allows a reload on a quiet page", () => {
    expect(safeToReload(doc(null))).toBe(true);
  });

  it("refuses while a modal or sheet is open", () => {
    // The proof-of-delivery sheet is an .overlay; reloading through it would
    // discard a signature the driver just collected.
    expect(safeToReload(doc(".overlay"))).toBe(false);
  });

  it("refuses while something is being typed into", () => {
    expect(safeToReload(doc("input:focus, textarea:focus, select:focus"))).toBe(false);
  });

  it("refuses when there is no document at all", () => {
    expect(safeToReload(null)).toBe(false);
  });
});
