"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { registerForPush } from "@/lib/native-bridge";
import type { Profile } from "@/lib/types";

// ============================================================
// Tells the server which phone to push to.
//
// Firebase hands each install a token; without it stored against the user, a
// notification has nowhere to go. Registered on every app start rather than
// once, because a token is not permanent — Firebase rotates it after a
// reinstall, a restore onto a new phone, or a long idle period, and a stale
// one fails silently forever.
//
// Renders nothing, and does nothing at all outside the APK.
// ============================================================

export function PushRegistrar({ me }: { me: Profile }) {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    void registerForPush(async (token) => {
      try {
        const supabase = createClient();
        // Upsert on the token: the same phone handed to a different driver
        // simply changes owner, instead of pushing that person's work to
        // someone else's pocket.
        await supabase.from("device_tokens").upsert(
          { token, user_id: me.id, platform: "android", updated_at: new Date().toISOString() },
          { onConflict: "token" },
        );
      } catch {
        // Nothing the driver can act on; the in-app bell is unaffected.
      }
    });
  }, [me.id]);

  return null;
}
