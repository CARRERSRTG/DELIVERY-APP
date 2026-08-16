"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { CAPABILITIES, ROLE_CAPS, ROLE_INFO, ROLE_ORDER, extraCaps, roleLabel } from "@/lib/constants";
import { avatarColor, initials } from "@/lib/utils";
import { UsersImportModal } from "@/components/UsersImportModal";
import type { Profile, UserRole } from "@/lib/types";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default function UsersPage() {
  const { me, users, settings, addUser, setUserIdentity, updateUserRole, updateUserName, updateUserStore, updateUserPermissions, deleteUser, saveSettings } = useData();
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("sales");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ signInWith: string; password: string; canReset: boolean } | null>(null);
  // Which user's permissions panel is expanded.
  const [perms, setPerms] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [groupByStore, setGroupByStore] = useState(true);

  // Team grouped by assigned store, in the settings store order, with a final
  // bucket for users with no store (admin / logistics / office). Within a group,
  // sorted by role then name.
  const groups = useMemo(() => {
    const NO_STORE = "__none__";
    const byStore = new Map<string, Profile[]>();
    for (const u of users) {
      const key = u.store || NO_STORE;
      (byStore.get(key) ?? byStore.set(key, []).get(key)!).push(u);
    }
    const out: { key: string; label: string; list: Profile[] }[] = [];
    for (const s of settings.stores) if (byStore.has(s.name)) out.push({ key: s.name, label: s.name, list: byStore.get(s.name)! });
    for (const [k, list] of byStore) if (k !== NO_STORE && !settings.stores.some((s) => s.name === k)) out.push({ key: k, label: k, list });
    if (byStore.has(NO_STORE)) out.push({ key: NO_STORE, label: t("No store (Admin / Office / Logistics)", "Sin tienda (Admin / Oficina / Logística)"), list: byStore.get(NO_STORE)! });
    for (const g of out) g.list.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || (a.full_name || "").localeCompare(b.full_name || ""));
    return out;
  }, [users, settings.stores, t]);

  if (!me) return null;
  if (me.role !== "admin") return <div className="empty">{t("Admins only.", "Solo administradores.")}</div>;

  const submit = async () => {
    setBusy(true);
    const res = await addUser({
      email: email.trim() || undefined,
      username: username.trim() || undefined,
      full_name: name, role, password: password.trim() || undefined,
    });
    setBusy(false);
    if (res.ok) {
      if (!LOCAL_MODE && res.password) {
        setCreated({
          // What they should TYPE. For a username account the derived address
          // is an implementation detail nobody should have to know or repeat.
          signInWith: res.signInWith || res.email || "",
          password: res.password,
          canReset: res.can_reset_own_password !== false,
        });
      }
      setEmail(""); setName(""); setRole("sales"); setPassword("");
    }
  };

  const renderRow = (u: Profile) => {
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
            {/* The login name, for people with no company address. Blank means
                they sign in with their email. Renaming it also moves the
                address they sign in at — the API keeps the two together, so
                this can't quietly lock someone out. */}
            {!LOCAL_MODE && (
              <input
                defaultValue={u.username ?? ""}
                placeholder={t("username (optional)", "usuario (opcional)")}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onBlur={(e) => {
                  const v = e.target.value.trim().toLowerCase();
                  if (v === (u.username ?? "")) return;
                  void setUserIdentity(u.id, { username: v || null });
                }}
                style={{ maxWidth: 240, marginTop: 4, fontSize: 12 }}
                title={t("Sign-in name for someone with no email", "Nombre de acceso para quien no tiene correo")}
              />
            )}
          </div>
          <select value={u.role} onChange={(e) => updateUserRole(u.id, e.target.value as UserRole)} style={{ maxWidth: 170 }}>
            {ROLE_ORDER.map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
          </select>
          {(u.role === "warehouse" || u.role === "driver" || u.role === "sales") && (
            <select value={u.store ?? ""} onChange={(e) => updateUserStore(u.id, e.target.value || null)} style={{ maxWidth: 150 }} title={t("Assigned store", "Tienda asignada")}>
              <option value="">{t("All stores", "Todas las tiendas")}</option>
              {settings.stores.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          )}
          {/* Customer visibility on the Accounts page. Admin always sees all;
              Manager/Logistics can be scoped to only their own customers. */}
          {(u.role === "manager" || u.role === "logistics") && (
            <select
              value={settings.customer_scope?.[u.id] ?? "all"}
              onChange={(e) => saveSettings({ customer_scope: { ...(settings.customer_scope ?? {}), [u.id]: e.target.value as "all" | "own" } })}
              style={{ maxWidth: 160 }}
              title={t("Customer visibility", "Visibilidad de clientes")}
            >
              <option value="all">{t("All customers", "Todos los clientes")}</option>
              <option value="own">{t("Own customers only", "Solo sus clientes")}</option>
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
  };

  // Either identifier will do. Requiring an email was what forced the office
  // to invent addresses for warehouse staff and drivers who don't have one.
  const canSubmit = LOCAL_MODE ? !!name.trim() : (!!email.trim() || !!username.trim());

  return (
    <>
      <div className="page-head">
        <h2>{t("Users", "Usuarios")}</h2>
        {!LOCAL_MODE && <button className="btn btn-ghost" onClick={() => setBulk(true)}>⬆ {t("Bulk import", "Importar en lote")}</button>}
      </div>

      <div className="card">
        <h2>{t("Create a user", "Crear un usuario")}</h2>
        <div className="grid g4">
          <div className="field"><label>{t("Full name", "Nombre completo")}</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" /></div>
          <div className="field">
            <label>{t("Email", "Correo")} {t("(or username below)", "(o usuario abajo)")}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@company.com" />
          </div>
          <div className="field">
            <label>{t("Username", "Usuario")}</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="maximo"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>{t("Role", "Rol")}</label>
            <select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              {ROLE_ORDER.map((r) => <option key={r} value={r}>{roleLabel(r, lang)}</option>)}
            </select>
          </div>
          {!LOCAL_MODE && (
            <div className="field">
              <label>{t("Password", "Contraseña")}</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("auto-generate if blank", "auto si vacío")} />
            </div>
          )}
        </div>
        <button className="btn btn-primary" onClick={submit} disabled={busy || !canSubmit}>
          {t("Create user", "Crear usuario")}
        </button>
        <div className="hint">
          {LOCAL_MODE
            ? t("In local demo mode users are created instantly in this browser. Switch to any of them from the yellow “View as” bar at the top.", "En modo demo local los usuarios se crean al instante en este navegador. Cámbialos desde la barra amarilla “Ver como” arriba.")
            : t("The account is created active — no email confirmation needed. Give the person their email + password below and they can sign in right away.", "La cuenta se crea activa — sin confirmación por correo. Entrega a la persona su correo + contraseña de abajo y podrá iniciar sesión de inmediato.")}
        </div>

        {created && (
          <div className="card" style={{ marginTop: 14, marginBottom: 0, background: "var(--accent-soft)", borderColor: "var(--accent)" }}>
            <b>{t("Account ready — share these credentials", "Cuenta lista — comparte estas credenciales")}</b>
            <div className="detail-row"><span className="dk">{t("Sign in with", "Entrar con")}</span><span className="dv">{created.signInWith}</span></div>
            <div className="detail-row"><span className="dk">{t("Password", "Contraseña")}</span><span className="dv" style={{ fontFamily: "monospace", fontSize: 15 }}>{created.password}</span></div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => navigator.clipboard?.writeText(`${created.signInWith} / ${created.password}`)}>
                📋 {t("Copy", "Copiar")}
              </button>
              <button className="btn btn-sm" onClick={() => setCreated(null)}>{t("Dismiss", "Cerrar")}</button>
            </div>
            <div className="hint">{t("This password is shown only once. The user can change it later.", "Esta contraseña se muestra solo una vez. El usuario puede cambiarla después.")}</div>
            {/* Said at the moment of creation, not discovered the day they
                forget it. A derived address receives no mail, so no reset link
                can ever reach them. */}
            {!created.canReset && (
              <div className="hint" style={{ color: "#b9791a", fontWeight: 600, marginTop: 6 }}>
                ⚠ {t(
                  "This account has no email, so it can never reset its own password — an admin has to set a new one.",
                  "Esta cuenta no tiene correo, así que nunca podrá restablecer su propia contraseña — un admin tendrá que ponerle una nueva.",
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="page-head" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>{t("Team", "Equipo")} ({users.length})</h2>
          <label style={{ margin: 0, textTransform: "none", letterSpacing: 0, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={groupByStore} onChange={(e) => setGroupByStore(e.target.checked)} style={{ width: "auto" }} />
            {t("Group by store", "Agrupar por tienda")}
          </label>
        </div>
        {groupByStore
          ? groups.map((g) => (
              <div key={g.key} style={{ marginBottom: 16 }}>
                <div className="section-label" style={{ marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
                  🏬 {g.label} <span className="count-tag">{g.list.length}</span>
                </div>
                {g.list.map(renderRow)}
              </div>
            ))
          : users.map(renderRow)}
      </div>

      {bulk && <UsersImportModal onClose={() => setBulk(false)} />}
    </>
  );
}
