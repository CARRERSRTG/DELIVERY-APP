"use client";

import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { CAPABILITIES, ROLE_INFO, extraCaps, permissionsFor, roleLabel } from "@/lib/constants";
import { avatarColor, initials } from "@/lib/utils";

// ============================================================
// "My Account" — every signed-in user gets this, whatever their role.
// Shows who they are, what they're allowed to do, and their personal
// preferences. A summary of their own work lives on the Summary tab.
// ============================================================

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default function AccountPage() {
  const { me, settings, users, updateUserName, notify } = useData();
  const { lang, theme, setLang, setTheme, t } = usePrefs();
  const [name, setName] = useState(me?.full_name ?? "");
  const [saving, setSaving] = useState(false);

  if (!me) return null;
  const role = ROLE_INFO[me.role];

  const saveName = async () => {
    const v = name.trim();
    if (!v || v === me.full_name) return;
    setSaving(true);
    await updateUserName(me.id, v);
    setSaving(false);
    notify(t("Name updated", "Nombre actualizado"));
  };

  return (
    <>
      <div className="page-head"><h2>{t("My account", "Mi cuenta")}</h2></div>

      {/* ---------- Identity ---------- */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <span className="avatar" style={{ background: avatarColor(me.full_name || "?"), width: 60, height: 60, flex: "0 0 60px", fontSize: 22 }}>
            {initials(me.full_name || "?")}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "Archivo, sans-serif", fontSize: 22, fontWeight: 800 }}>{me.full_name}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
              <span className="sema" style={{ background: role.color, color: "#fff" }}>{roleLabel(me.role, lang)}</span>
              {me.store && <span className="sema" style={{ background: "var(--gray)", color: "#fff" }}>🏬 {me.store}</span>}
            </div>
            <div className="hint" style={{ marginTop: 6 }}>{lang === "es" ? role.desc_es : role.desc}</div>
          </div>
        </div>
      </div>

      {/* ---------- Profile + preferences ---------- */}
      <div className="card">
        <h2>👤 {t("Profile", "Perfil")}</h2>
        <div className="grid g2" style={{ maxWidth: 520 }}>
          <div className="field">
            <label>{t("Display name", "Nombre visible")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn btn-primary" onClick={saveName} disabled={saving || !name.trim() || name.trim() === me.full_name}>
                {t("Save", "Guardar")}
              </button>
            </div>
          </div>
          <div className="field">
            <label>{t("Store", "Tienda")}</label>
            <input value={me.store || t("All stores", "Todas las tiendas")} disabled />
            <div className="hint">{t("Only an admin can change your store.", "Solo un administrador puede cambiar su tienda.")}</div>
          </div>
        </div>

        <div className="grid g2" style={{ maxWidth: 520 }}>
          <div className="field">
            <label>{t("Language", "Idioma")}</label>
            <div className="toggle-group">
              <button className={"toggle-btn " + (lang === "en" ? "on" : "")} onClick={() => setLang("en")}>🇬🇧 English</button>
              <button className={"toggle-btn " + (lang === "es" ? "on" : "")} onClick={() => setLang("es")}>🇪🇸 Español</button>
            </div>
          </div>
          <div className="field">
            <label>{t("Theme", "Tema")}</label>
            <div className="toggle-group">
              <button className={"toggle-btn " + (theme === "light" ? "on" : "")} onClick={() => setTheme("light")}>☀️ {t("Light", "Claro")}</button>
              <button className={"toggle-btn " + (theme === "dark" ? "on" : "")} onClick={() => setTheme("dark")}>🌙 {t("Dark", "Oscuro")}</button>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- Change password ---------- */}
      <div className="card">
        <h2>🔒 {t("Change password", "Cambiar contraseña")}</h2>
        {LOCAL_MODE ? (
          <p className="hint" style={{ marginTop: 0 }}>
            {t(
              "Not available in local demo mode — there's no real account here, so no password to change.",
              "No disponible en modo demo local — no hay una cuenta real aquí, así que no hay contraseña que cambiar.",
            )}
          </p>
        ) : (
          <ChangePassword t={t} />
        )}
      </div>

      {/* ---------- What I can do ---------- */}
      <div className="card">
        <h2>🔑 {t("What I can do", "Lo que puedo hacer")}</h2>
        <div className="pill-list">
          {permissionsFor(me.role, lang, settings.role_permissions).map((p) => (
            <span key={p} className="pill-item">✓ {p}</span>
          ))}
          {/* Capabilities an admin granted to this person specifically. */}
          {extraCaps(me).map((c) => {
            const info = CAPABILITIES.find((x) => x.key === c);
            return (
              <span key={c} className="pill-item" style={{ borderColor: "var(--amber)", background: "#fff7ec" }}>
                ★ {info ? (lang === "es" ? info.es : info.en) : c}
              </span>
            );
          })}
        </div>
        {extraCaps(me).length > 0 && (
          <div className="hint" style={{ marginTop: 8 }}>
            ★ {t("Granted to you specifically by an admin.", "Otorgado a usted específicamente por un administrador.")}
          </div>
        )}
        <div className="hint" style={{ marginTop: 10 }}>
          {t("Workspace", "Espacio")}: <b>{settings.app_name}</b> · {t("Team", "Equipo")}: {users.length} {t("people", "personas")}
        </div>
      </div>
    </>
  );
}

/** Self-service password change — verifies the current password before
 * setting the new one, same as any account-security page should. */
function ChangePassword({ t }: { t: (en: string, es: string) => string }) {
  const supabase = createClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const submit = async () => {
    setMsg(null);
    if (next.length < 6) {
      setMsg({ text: t("New password must be at least 6 characters.", "La nueva contraseña debe tener al menos 6 caracteres."), ok: false });
      return;
    }
    if (next !== confirm) {
      setMsg({ text: t("New passwords don't match.", "Las contraseñas nuevas no coinciden."), ok: false });
      return;
    }
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) throw new Error(t("Could not verify your account.", "No se pudo verificar su cuenta."));
      const { error: verifyErr } = await supabase.auth.signInWithPassword({ email: user.email, password: current });
      if (verifyErr) throw new Error(t("Current password is incorrect.", "La contraseña actual es incorrecta."));
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
      setMsg({ text: t("Password updated.", "Contraseña actualizada."), ok: true });
      setCurrent(""); setNext(""); setConfirm("");
    } catch (e) {
      setMsg({ text: (e as Error).message, ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="grid g2" style={{ maxWidth: 520 }}>
        <div className="field">
          <label>{t("Current password", "Contraseña actual")}</label>
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        </div>
        <div />
        <div className="field">
          <label>{t("New password", "Nueva contraseña")}</label>
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
        </div>
        <div className="field">
          <label>{t("Confirm new password", "Confirmar nueva contraseña")}</label>
          <input
            type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="••••••••" autoComplete="new-password"
          />
        </div>
      </div>
      <button className="btn btn-primary" onClick={submit} disabled={busy || !current || !next || !confirm}>
        {busy ? "…" : t("Update password", "Actualizar contraseña")}
      </button>
      {msg && <div className="hint" style={{ marginTop: 10, color: msg.ok ? "var(--green)" : "var(--red)" }}>{msg.text}</div>}
    </>
  );
}

