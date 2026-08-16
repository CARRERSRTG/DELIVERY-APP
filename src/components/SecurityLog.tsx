"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { isSensitive, securityLabel } from "@/lib/security-log";

// ============================================================
// Who changed someone's access, and when.
//
// Admins only, and read-only by design — an audit trail its readers can edit
// is not an audit trail (the table grants no update or delete to anyone).
//
// Fetched here rather than through the data provider: this is rarely opened,
// and loading it with every page would make every screen in the app pay for a
// table almost nobody reads.
// ============================================================

interface Row {
  id: string;
  actor_id: string | null;
  target_id: string | null;
  target_name: string | null;
  kind: string;
  detail: string | null;
  created_at: string;
}

export function SecurityLog() {
  const { users, me } = useData();
  const { lang, t } = usePrefs();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (me?.role !== "admin") return;
    let cancelled = false;
    (async () => {
      const { data, error } = await createClient()
        .from("security_events")
        .select("id, actor_id, target_id, target_name, kind, detail, created_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (cancelled) return;
      if (error) setErr(error.message);
      else setRows((data ?? []) as Row[]);
    })();
    return () => { cancelled = true; };
  }, [me?.role]);

  const nameById = useMemo(() => new Map(users.map((u) => [u.id, u.full_name])), [users]);

  if (me?.role !== "admin") return null;

  return (
    <div className="card">
      <h2>
        🛡 {t("Access changes", "Cambios de acceso")}
        {rows && <span className="count-tag">{rows.length}</span>}
      </h2>
      <div className="hint" style={{ marginTop: -6, marginBottom: 10 }}>
        {t(
          "Roles, permissions, sign-in details and password resets. Passwords themselves are never recorded.",
          "Roles, permisos, datos de acceso y restablecimientos de contraseña. Las contraseñas nunca se registran.",
        )}
      </div>

      {err && <div className="empty" style={{ color: "var(--red)" }}>{err}</div>}
      {!err && !rows && <div className="empty">{t("Loading…", "Cargando…")}</div>}
      {rows?.length === 0 && (
        <div className="empty">{t("Nothing yet — this starts from today.", "Nada aún — esto empieza desde hoy.")}</div>
      )}

      {!!rows?.length && (
        <div className="tbl-scroll">
          <table className="orders" style={{ minWidth: 640 }}>
            <thead>
              <tr>
                <th>{t("When", "Cuándo")}</th>
                <th>{t("What", "Qué")}</th>
                <th>{t("To whom", "A quién")}</th>
                <th>{t("Change", "Cambio")}</th>
                <th>{t("By", "Por")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {new Date(r.created_at).toLocaleString(lang === "es" ? "es-MX" : "en-US", { timeZone: "America/Chicago" })}
                  </td>
                  <td>
                    <span
                      className="sema"
                      style={isSensitive(r.kind)
                        ? { background: "var(--red)", color: "#fff" }
                        : { background: "var(--card-hover)", color: "var(--ink-soft)" }}
                    >
                      {securityLabel(r.kind, lang)}
                    </span>
                  </td>
                  {/* The stored name, not a lookup: a removed account has no
                      profile left to look up, and that entry is the one most
                      worth being able to read later. */}
                  <td>{r.target_name ?? (r.target_id ? nameById.get(r.target_id) ?? "—" : "—")}</td>
                  <td className="hint" style={{ marginTop: 0 }}>{r.detail ?? "—"}</td>
                  <td>{r.actor_id ? nameById.get(r.actor_id) ?? "—" : t("system", "sistema")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
