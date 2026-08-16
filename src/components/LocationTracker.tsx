"use client";

import { useMemo } from "react";
import { useData } from "@/lib/data-provider";
import { useLiveLocation } from "@/lib/useLiveLocation";
import { deviceId, isShiftDevice } from "@/lib/device-id";
import { isNativeApp } from "@/lib/native-bridge";
import type { Profile } from "@/lib/types";

// ============================================================
// Keeps position sharing running for a driver's whole shift.
//
// THIS LIVES IN THE LAYOUT ON PURPOSE, and that is the entire point of the
// component.
//
// It used to run inside ShiftClock, which only renders on the Orders screen.
// So the moment a driver tapped "My route", Next.js unmounted that screen, the
// hook's cleanup ran, removeWatcher() fired, and Android tore down the
// foreground service — while the driver was still clocked in. The truck simply
// vanished from dispatch until they navigated back, and on return the watcher
// starts fresh: it refuses the cached position and waits for 40 m of movement,
// so a parked truck stayed invisible for as long as it stayed parked. That is
// exactly the "45 minutes to come back as LIVE" that got reported.
//
// Mounted here it survives every navigation inside the app, so the only things
// that stop tracking are the ones that should: clocking out, or closing the
// app.
//
// Renders nothing.
// ============================================================

export function LocationTracker({ me }: { me: Profile }) {
  const { shifts } = useData();

  const track = useMemo(() => {
    const shift = shifts.find((s) => s.driver_id === me.id && !s.ended_at);
    if (!shift) return false;
    // ONLY THE PHONE THAT CLOCKED IN.
    //
    // A driver's account can be signed in on more than one device — the office
    // logs in to look at something. Without this, every one of them reports
    // position for the same shift, and the day's track ends up stitched from
    // two places at once. That really happened: one day came out at 4,936
    // miles with fixes 1,300 miles apart.
    //
    // Unknown on either side is permissive: a shift opened before this
    // existed, or a phone that can't keep local storage, keeps working. Going
    // dark on a real driver mid-route would be worse than the mixing it
    // prevents.
    if (!isShiftDevice(shift.device_id, deviceId())) return false;
    // A browser is someone reviewing, not someone driving. Only the APK can
    // report with the screen off anyway, so this costs nothing real and shuts
    // the office's laptop out of the driver's track for good.
    return isNativeApp();
  }, [shifts, me.id]);

  useLiveLocation(track);
  return null;
}
