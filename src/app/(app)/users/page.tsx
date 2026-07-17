"use client";

import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { CAPABILITIES, ROLE_CAPS, ROLE_INFO, ROLE_ORDER, extraCaps, roleLabel } from "@/lib/constants";
import { avatarColor, initials } from "@/lib/utils";
import type { UserRole } from "@/lib/types";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default function UsersPage() {
  const { me, users, settings, addUser, updateUserRole, updateUserName, updateUserStore, updateUserPermissions, deleteUser } = useData();
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("sales");
  const [busy, setBusy] = useState(false);
  // Which user's permissions panel is expanded.
  const [perms, setPerms] = useState<string | null>(null);

  if (!me) return null;
  if (me.role !== "admin") return <div className="empty">{t("Admins only.", "Solo administradores.")}</div>;

  const submit = async () => {
    setBusy(true);
    const ok = await addUser({ email, full_name: name, role });
    setBusy(false);
    if (ok) { setEmail(""); setName(""); setRole("sales"); }
  };

  const canSubmit = LOCAL_MODE ? !!name.trim() : !!email.trim();

  return (
    <>
      <div className="page-head"><h2>{t("Users", "Usuarios")}</h2></div>

      <div className="card">
        <h2>{LOCAL_MODE ? t("Create a user", "Crear un usuario") : t("Invite a user", "Invitar un usuario")}</h2>
        <div className="grid g3">
          <div className="field"><label>{t("Full name", "Nombre completo")}</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" /></div>
          <div className="field"><label>{t("Email", "Correo")}{LOCAL_MODE ? ` (${t("optional", "opcional")})` : ""}</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" /></div>
          <div className="field">
            <label>{t("Role", "Rol")}</label>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {ROLE_ORDER.map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" onClick={submit} disabled={busy || !canSubmit}>
          {LOCAL_MODE ? t("Create user", "Crear usuario") : t("Send invite", "Enviar invitación")}
        </button>
        <div className="hint">
          {LOCAL_MODE
            ? t("In local demo mode users are created instantly in this browser. Switch to any of them from the yellow “View as” bar at the top.", "En modo demo local los usuarios se crean al instante en este navegador. Cámbialos desde la barra amarilla “Ver como” arriba.")
            : t("The user gets an email link to set their password. Requires SUPABASE_SERVICE_ROLE_KEY in the server env.", "El usuario recibe un enlace por correo para crear su contraseña. Requiere SUPABASE_SERVICE_ROLE_KEY en el servidor.")}
        </div>
      </div>

      <div className="card">
        <h2>{t("Team", "Equipo")} ({users.length})</h2>
        {users.map((u) => {
          const info = ROLE_INFO[u.role];
          const extra = extraCaps(u);
          return (
            <div key={u.id}>
            <div className="user-row" style={{ marginBottom: perms === u.id ? 0 : undefined }}>
              <span className="avatar" style={{ background: avatarColor(u.full_name || "?") }}>{initials(u.full_name || "?")}</span>
              <div style={{ flex: 1, minWidth: 160 }}>
                <input
                  defaultValue={u.full_name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== u.full_name && updateUserName(u.id, e.target.value.trim())}
                  style={{ fontWeight: 700, maxWidth: 240 }}
                />
              </div>
              <select value={u.role} onChange={(e) => updateUserRole(u.id, e.target.value as UserRole)} style={{ maxWidth: 170 }}>
                {ROLE_ORDER.map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
              </select>
              {(u.role === "warehouse" || u.role === "driver") && (
                <select value={u.store ?? ""} onChange={(e) => updateUserStore(u.id, e.target.value || null)} style={{ maxWidth: 150 }} title={t("Assigned store", "Tienda asignada")}>
                  <option value="">{t("All stores", "Todas las tiendas")}</option>
                  {settings.stores.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                </select>
              )}
              <span className="sema" style={{ background: info.color, color: "#fff" }}>{roleLabel(u.role, lang)}</span>
              <button
                className={"btn btn-sm " + (extra.length ? "btn-amber" : "btn-ghost")}
                onClick={() => setPerms(perms === u.id ? null : u.id)}
                title={t("Grant extra permissions", "Otorgar permisos extra")}
              >
                🔑 {extra.length ? `+${extra.length}` : t("Permissions", "Permisos")}
              </button>
              {u.id !== me.id && (
                <button className="btn btn-danger btn-sm" onClick={async () => {
                  if (await confirmAction(
                    t(`Remove ${u.full_name}? This deletes their login.`, `¿Eliminar a ${u.full_name}? Esto borra su acceso.`),
                    { danger: true, confirmLabel: t("Remove", "Eliminar") },
                  )) await deleteUser(u.id);
                }}>{t("Remove", "Eliminar")}</button>
              )}
            </div>

            {perms === u.id && (
              <div className="perm-panel">
                <div className="hint" style={{ marginBottom: 10 }}>
                  {t(
                    `Extra permissions for ${u.full_name}, on top of what the ${roleLabel(u.role, lang)} role already allows. Role-granted ones are locked on.`,
                    `Permisos extra para ${u.full_name}, además de lo que el rol ${roleLabel(u.role, lang)} ya permite. Los del rol están fijos.`,
                  )}
                </div>
                <div className="grid g2">
                  {CAPABILITIES.map((c) => {
                    const fromRole = ROLE_CAPS[u.role].includes(c.key);
                    const granted = fromRole || !!u.permissions?.includes(c.key);
                    return (
                      <label key={c.key} className={"perm-opt " + (fromRole ? "locked" : "")}>
                        <input
                          type="checkbox"
                          checked={granted}
                          disabled={fromRole}
                          onChange={(e) => {
                            const cur = (u.permissions ?? []).filter((p) => p !== c.key);
                            updateUserPermissions(u.id, e.target.checked ? [...cur, c.key] : cur);
                          }}
                        />
                        <span>
                          <b>{lang === "es" ? c.es : c.en}</b>
                          {fromRole && <span className="sema" style={{ background: "var(--gray)", color: "#fff", marginLeft: 6 }}>{t("from role", "del rol")}</span>}
                          <span className="hint" style={{ display: "block" }}>{lang === "es" ? c.desc_es : c.desc_en}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            </div>
          );
        })}
      </div>
    </>
  );
}
