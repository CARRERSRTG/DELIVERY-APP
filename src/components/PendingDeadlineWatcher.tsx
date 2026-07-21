"use client";

import { useEffect } from "react";
import { useData } from "@/lib/data-provider";
import { nowHHMM, orderOwner, todayISO } from "@/lib/utils";
import type { NotifSeed } from "@/lib/notifications";

const FIRED_KEY_PREFIX = "rtg_deadline_fired_";

function alreadyFired(key: string): boolean {
  try {
    const raw = localStorage.getItem(FIRED_KEY_PREFIX + todayISO());
    if (!raw) return false;
    return (JSON.parse(raw) as string[]).includes(key);
  } catch {
    return false;
  }
}

function markFired(key: string): void {
  try {
    const storageKey = FIRED_KEY_PREFIX + todayISO();
    const raw = localStorage.getItem(storageKey);
    const list: string[] = raw ? JSON.parse(raw) : [];
    if (!list.includes(key)) localStorage.setItem(storageKey, JSON.stringify([...list, key]));
  } catch { /* best-effort only */ }
}

/** Client-only watcher (mounted once in TopBar, so it runs on every page for
 * every logged-in role): once it's past today's configured cutoff and an
 * order is still "pending", escalate — managers first, then the sales rep
 * who submitted it a bit later. Fires at most once per order per day per
 * escalation step (tracked in localStorage), and only while a browser tab
 * with the app open is checking — there's no server-side cron here. */
export function PendingDeadlineWatcher() {
  const { me, deliveries, users, settings, pushNotifs } = useData();

  useEffect(() => {
    if (!me) return;

    const check = () => {
      const now = nowHHMM();
      const mgrCutoff = settings.manager_pending_cutoff;
      const salesCutoff = settings.sales_pending_cutoff;
      if (!mgrCutoff && !salesCutoff) return;

      for (const d of deliveries) {
        if (d.stage !== "pending") continue;

        if (mgrCutoff && now >= mgrCutoff) {
          const key = `${d.id}:mgr:${mgrCutoff}`;
          if (!alreadyFired(key)) {
            const seeds: NotifSeed[] = users
              .filter((u) => u.role === "manager")
              .map((u) => ({
                user_id: u.id,
                delivery_id: d.id,
                order_no: d.order_no,
                kind: "pending_deadline_manager",
                message: `Order #${d.order_no} is still pending approval and needs immediate action`,
              }));
            markFired(key);
            if (seeds.length) pushNotifs(seeds);
          }
        }

        const owner = orderOwner(d);
        if (salesCutoff && now >= salesCutoff && owner) {
          const key = `${d.id}:sales:${salesCutoff}`;
          if (!alreadyFired(key)) {
            markFired(key);
            pushNotifs([{
              user_id: owner,
              delivery_id: d.id,
              order_no: d.order_no,
              kind: "pending_deadline_sales",
              message: `Your order #${d.order_no} is still pending approval — follow up with your manager`,
            }]);
          }
        }
      }
    };

    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id, deliveries, users, settings.manager_pending_cutoff, settings.sales_pending_cutoff]);

  return null;
}
