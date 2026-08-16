import { createAdminClient } from "@/lib/supabase/admin";
import type { SecurityKind } from "@/lib/security-log";

/**
 * Write one line to the security log. SERVER ONLY.
 *
 * Never throws and never blocks the caller. A failure to log must not undo a
 * password reset the admin already believes happened — a missing line is a
 * smaller problem than a half-applied change.
 */
export async function logSecurity(args: {
  actorId: string | null;
  targetId: string | null;
  targetName: string | null;
  kind: SecurityKind;
  detail?: string | null;
}): Promise<void> {
  try {
    await createAdminClient().from("security_events").insert({
      actor_id: args.actorId,
      target_id: args.targetId,
      target_name: args.targetName,
      kind: args.kind,
      detail: args.detail ?? null,
    });
  } catch {
    /* logging must never be the thing that fails */
  }
}
