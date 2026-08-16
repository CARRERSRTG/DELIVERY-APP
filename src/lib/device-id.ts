// ============================================================
// A stable id for THIS install of the app.
//
// Not an identity and not a fingerprint: a random value kept in local storage,
// used only to answer "is this the same phone that clocked in?". It never
// leaves the account it belongs to, and clearing app data simply mints a new
// one.
//
// It exists because a driver's account can be signed in on more than one
// device — the office logs in to check something — and without this every one
// of them reports position for the same shift.
// ============================================================

const KEY = "rtg_device_id";

/** This install's id, creating one on first use. Null on the server. */
export function deviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const existing = window.localStorage.getItem(KEY);
    if (existing) return existing;
    const fresh =
      (typeof crypto !== "undefined" && "randomUUID" in crypto)
        ? crypto.randomUUID()
        : `d-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Private mode, or storage disabled. Unknown, which tracks permissively.
    return null;
  }
}

/**
 * Should THIS device report position for a shift that was started on
 * `shiftDevice`?
 *
 * Unknown on either side means yes. A shift opened before device binding
 * existed, or a phone that can't keep local storage, must keep working — a
 * guard that silently stops tracking a real driver mid-route would be worse
 * than the double-reporting it prevents.
 */
export function isShiftDevice(shiftDevice: string | null | undefined, mine: string | null): boolean {
  if (!shiftDevice) return true;
  if (!mine) return true;
  return shiftDevice === mine;
}
