"use client";

import { useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { CAPABILITIES, ROLE_INFO, extraCaps, permissionsFor, roleLabel, stageInfo, stageLabel } from "@/lib/constants";
import { avatarColor, fmtDate, fmtMoney, initials, isOverdue } from "@/lib/utils";

// ============================================================
// "My Account" — every signed-in user gets this, whatever their role.
// Shows who they are, what they're allowed to do, their personal preferences,
// and a summary of their own work (orders they logged, or runs assigned to
// them if they're a driver).
// ============================================================

export default function AccountPage() {
  const { me, deliveries, settings, users, updateUserName, notify } = useData();
  const { lang, theme, setLang, setTheme, t } = usePrefs();
  const [name, setName] = useState(me?.full_name ?? "");
  const [saving, setSaving] = useState(false);

  // A driver's work is what's assigned to them; everyone else's is what they logged.
  const mine = useMemo(() => {
    if (!me) return [];
    return me.role === "driver"
      ? deliveries.filter((d) => d.assigned_driver === me.full_name || d.created_by === me.id)
      : deliveries.filter((d) => d.created_by === me.id);
  }, [deliveries, me]);

  const stats = useMemo(() => {
    const active = mine.filter((d) => !["delivered", "canceled", "rejected"].includes(d.stage));
    return {
      total: mine.length,
      active: active.length,
      delivered: mine.filter((d) => d.stage === "delivered").length,
      overdue: mine.filter(isOverdue).length,
      fees: Math.round(mine.filter((d) => d.stage !== "canceled").reduce((s, d) => s + (d.delivery_fee ?? 0), 0) * 100) / 100,
    };
  }, [mine]);

  const recent = useMemo(() => [...mine].sort((a, b) => b.order_no - a.order_no).slice(0, 8), [mine]);

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

      {/* ---------- My numbers ---------- */}
      <div className="card">
        <h2>📊 {me.role === "driver" ? t("My deliveries", "Mis entregas") : t("My orders", "Mis órdenes")}</h2>
        <div className="kpi-grid" style={{ marginBottom: 0 }}>
          <div className="kpi"><b>{stats.total}</b><span>{t("Total", "Total")}</span></div>
          <div className="kpi"><b style={{ color: "var(--accent)" }}>{stats.active}</b><span>{t("In progress", "En curso")}</span></div>
          <div className="kpi"><b style={{ color: "var(--green)" }}>{stats.delivered}</b><span>{t("Delivered", "Entregadas")}</span></div>
          <div className="kpi"><b style={{ color: stats.overdue ? "var(--red)" : undefined }}>{stats.overdue}</b><span>{t("Overdue", "Atrasadas")}</span></div>
          {me.role !== "driver" && (
            <div className="kpi"><b style={{ color: "var(--green)", fontSize: 17 }}>{fmtMoney(stats.fees)}</b><span>{t("Fees charged", "Cobros")}</span></div>
          )}
        </div>
      </div>

      {/* ---------- Recent work ---------- */}
      <div className="card">
        <h2>🕑 {t("Recent", "Recientes")}</h2>
        {recent.length === 0 ? (
          <div className="empty">{t("Nothing logged yet.", "Nada registrado aún.")}</div>
        ) : (
          <div className="bar-list">
            {recent.map((d) => (
              <div key={d.id} className="acct-row">
                <span className="ordno">#{d.order_no}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.account || t("(no account)", "(sin cuenta)")}
                </span>
                <span className="hint">{fmtDate(d.delivery_date)}</span>
                <span className="sema" style={{ background: stageInfo(d.stage).color, color: "#fff" }}>{stageLabel(d.stage, lang)}</span>
              </div>
            ))}
          </div>
        )}
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

