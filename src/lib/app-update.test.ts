import { describe, expect, it } from "vitest";
import { installedApkVersion, updateAvailable } from "./app-update";

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
