"use client";

import { useCallback, useEffect, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { CAPABILITIES, ROLE_CAPS, ROLE_INFO, ROLE_ORDER, extraCaps, roleLabel } from "@/lib/constants";
import { avatarColor, initials } from "@/lib/utils";
import type { Profile, UserRole } from "@/lib/types";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

// ============================================================
// Everything about one person, in one place.
//
// All of this used to live on the row itself: two text boxes, three dropdowns,
// a permissions toggle, a password button and a delete button, repeated for
// every member of staff. Twenty-nine of them made a wall of controls where the
// only thing anyone was actually scanning for was a name.
//
// So the list went back to names and roles, and the configuring moved here,
// where there is room to say what each setting means.
// ============================================================

interface SignIn { email: string; synthetic: boolean; can_reset_own_password: boolean; last_sign_in_at: string | null }

export function UserDialog({ user: u, onClose }: { user: Profile; onClose: () => void }) {
  const { me, notify, settings, setUserIdentity, resetUserPassword, updateUserRole, updateUserName, updateUserStore, updateUserPermissions, deleteUser, saveSettings } = useData();
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();

  const [signIn, setSignIn] = useState<SignIn | null>(null);
  const [newPass, setNewPass] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The email lives in auth, not on the profile, so it has to be fetched -
  // and re-fetched after any change, or the dialog keeps showing the address
  // that was just replaced.
  const refreshSignIn = useCallback(async () => {
    if (LOCAL_MODE) return;
    try {
      const res = await fetch(`/api/user-identity?id=${encodeURIComponent(u.id)}`);
      if (res.ok) setSignIn((await res.json()) as SignIn);
    } catch { /* the rest of the dialog still works */ }
  }, [u.id]);

  useEffect(() => { void refreshSignIn(); }, [refreshSignIn]);

  if (!me) return null;
  const info = ROLE_INFO[u.role];
  const extra = extraCaps(u);
  const scoped = u.role === "manager" || u.role === "logistics";
  const storeScoped = u.role === "warehouse" || u.role === "driver" || u.role === "sales";

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <span className="avatar" style={{ background: avatarColor(u.full_name || "?") }}>{initials(u.full_name || "?")}</span>
          <h3 style={{ margin: 0, flex: 1 }}>{u.full_name}</h3>
          <span className="sema" style={{ background: info.color, color: "#fff" }}>{roleLabel(u.role, lang)}</span>
        </div>
        <div className="hint" style={{ marginBottom: 14 }}>{lang === "es" ? info.desc_es : info.desc}</div>

        {/* ---------- Who they are ---------- */}
        <div className="section-label">{t("Identity", "Identidad")}</div>
        <div className="grid g2">
          <div className="field">
            <label>{t("Full name", "Nombre completo")}</label>
            <input
              defaultValue={u.full_name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== u.full_name && updateUserName(u.id, e.target.value.trim())}
            />
          </div>
          {!LOCAL_MODE && (
            <div className="field">
              <label>{t("Username", "Usuario")}</label>
              <input
                defaultValue={u.username ?? ""}
                placeholder={t("none — signs in with email", "ninguno — entra con correo")}
                autoCapitalize="none" autoCorrect="off" spellCheck={false}
                onBlur={async (e) => {
                  const v = e.target.value.trim().toLowerCase();
                  if (v === (u.username ?? "")) return;
                  await setUserIdentity(u.id, { username: v || null });
                  // A rename can move the sign-in address with it.
                  void refreshSignIn();
                }}
              />
            </div>
          )}
        </div>

        {!LOCAL_MODE && (
          <div className="field">
            <label>{t("Email", "Correo")}</label>
            <input
              type="email"
              defaultValue={signIn?.email ?? ""}
              placeholder={signIn?.synthetic ? t("none on file", "ninguno registrado") : ""}
              onBlur={async (e) => {
                const v = e.target.value.trim().toLowerCase();
                if (v === (signIn?.email ?? "")) return;
                // Emptying the field means "sign in with the username from now
                // on". It used to be silently ignored, which looked exactly
                // like a save that failed.
                if (!v) {
                  if (!u.username) {
                    notify(t("Give them a username first - with no email they would have no way to sign in.",
                             "Ponle primero un usuario - sin correo no tendria forma de entrar."));
                    e.target.value = signIn?.email ?? "";
                    return;
                  }
                  const ok = await confirmAction(
                    t(`${u.full_name} will sign in as "${u.username}" and can no longer reset their own password. Remove the email?`,
                      `${u.full_name} entrara como "${u.username}" y ya no podra restablecer su propia contrasena. Quitar el correo?`),
                    { confirmLabel: t("Remove email", "Quitar correo") },
                  );
                  if (!ok) { e.target.value = signIn?.email ?? ""; return; }
                  await setUserIdentity(u.id, { email: null });
                } else {
                  await setUserIdentity(u.id, { email: v });
                }
                void refreshSignIn();
              }}
            />
            {/* Said here rather than discovered the day they forget. */}
            {signIn && !signIn.can_reset_own_password && (
              <div className="hint" style={{ color: "#b9791a", fontWeight: 600 }}>
                ⚠ {t(
                  "No email, so this account can never reset its own password — use the button below when they call.",
                  "Sin correo, así que esta cuenta nunca podrá restablecer su contraseña — usa el botón de abajo cuando te hablen.",
                )}
              </div>
            )}
          </div>
        )}

        {/* ---------- What they can reach ---------- */}
        <div className="section-label">{t("Role and scope", "Rol y alcance")}</div>
        <div className="grid g2">
          <div className="field">
            <label>{t("Role", "Rol")}</label>
            <select value={u.role} onChange={(e) => updateUserRole(u.id, e.target.value as UserRole)}>
              {ROLE_ORDER.map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
            </select>
          </div>
          {storeScoped && (
            <div className="field">
              <label>{t("Assigned store", "Tienda asignada")}</label>
              <select value={u.store ?? ""} onChange={(e) => updateUserStore(u.id, e.target.value || null)}>
                <option value="">{t("All stores", "Todas las tiendas")}</option>
                {settings.stores.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </div>
          )}
          {scoped && (
            <div className="field">
              <label>{t("Customer visibility", "Visibilidad de clientes")}</label>
              <select
                value={settings.customer_scope?.[u.id] ?? "all"}
                onChange={(e) => saveSettings({ customer_scope: { ...(settings.customer_scope ?? {}), [u.id]: e.target.value as "all" | "own" } })}
              >
                <option value="all">{t("All customers", "Todos los clientes")}</option>
                <option value="own">{t("Own customers only", "Solo sus clientes")}</option>
              </select>
            </div>
          )}
        </div>

        {/* ---------- Extra permissions ---------- */}
        <div className="section-label">
          {t("Extra permissions", "Permisos extra")}
          {extra.length > 0 && <span className="count-tag" style={{ marginLeft: 8 }}>+{extra.length}</span>}
        </div>
        <div className="hint" style={{ marginBottom: 8 }}>
          {t(
            `On top of what the ${roleLabel(u.role, lang)} role already allows. The role's own are locked on.`,
            `Además de lo que el rol ${roleLabel(u.role, lang)} ya permite. Los del rol están fijos.`,
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

        {/* ---------- Access ---------- */}
        {!LOCAL_MODE && (
          <>
            <div className="section-label">{t("Access", "Acceso")}</div>
            {newPass ? (
              <div className="card" style={{ margin: 0, background: "var(--accent-soft)", borderColor: "var(--accent)" }}>
                <div className="detail-row">
                  <span className="dk">{t("New password", "Contraseña nueva")}</span>
                  <span className="dv" style={{ fontFamily: "monospace", fontSize: 17 }}>{newPass}</span>
                </div>
                <div className="hint">
                  {t("Shown once. Their old password stopped working when you pressed the button.",
                     "Se muestra una sola vez. La anterior dejó de servir al presionar el botón.")}
                </div>
                <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}
                  onClick={() => navigator.clipboard?.writeText(newPass)}>📋 {t("Copy", "Copiar")}</button>
              </div>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={async () => {
                  if (!(await confirmAction(
                    t(`Give ${u.full_name} a new password? Their current one stops working immediately.`,
                      `¿Dar a ${u.full_name} una contraseña nueva? La actual deja de servir de inmediato.`),
                    { confirmLabel: t("New password", "Nueva contraseña") },
                  ))) return;
                  setBusy(true);
                  const res = await resetUserPassword(u.id);
                  setBusy(false);
                  if (res.ok && res.password) setNewPass(res.password);
                }}
              >🔒 {t("Set a new password", "Poner contraseña nueva")}</button>
            )}
            {signIn?.last_sign_in_at && (
              <div className="hint" style={{ marginTop: 6 }}>
                {t("Last signed in", "Último acceso")}: {new Date(signIn.last_sign_in_at).toLocaleString(lang === "es" ? "es-MX" : "en-US")}
              </div>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={onClose}>{t("Done", "Listo")}</button>
          <span style={{ flex: 1 }} />
          {/* An admin can't delete themselves out of the only admin account. */}
          {u.id !== me.id && (
            <button className="btn btn-danger btn-sm" onClick={async () => {
              if (await confirmAction(
                t(`Remove ${u.full_name}? This deletes their login.`, `¿Eliminar a ${u.full_name}? Esto borra su acceso.`),
                { danger: true, confirmLabel: t("Remove", "Eliminar") },
              )) { await deleteUser(u.id); onClose(); }
            }}>{t("Remove", "Eliminar")}</button>
          )}
        </div>
      </div>
    </div>
  );
}
