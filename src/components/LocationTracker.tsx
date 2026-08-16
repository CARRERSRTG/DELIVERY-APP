"use client";

import { useMemo } from "react";
import { useData } from "@/lib/data-provider";
import { useLiveLocation } from "@/lib/useLiveLocation";
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
  const open = useMemo(
    () => shifts.some((s) => s.driver_id === me.id && !s.ended_at),
    [shifts, me.id],
  );
  useLiveLocation(open);
  return null;
}
