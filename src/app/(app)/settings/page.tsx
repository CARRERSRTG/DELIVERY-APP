"use client";

import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import Link from "next/link";
import { ROLE_DEFAULT_COLUMNS, ROLE_INFO, ROLE_ORDER, defaultPermissions, driverNames, roleLabel } from "@/lib/constants";
import { DEFAULT_COLUMNS, ORDER_COLUMNS } from "@/components/OrdersTable";
import type { Settings, UserRole } from "@/lib/types";

export default function SettingsPage() {
  const { me, users, settings, saveSettings, notify } = useData();
  const { lang, theme, setLang, setTheme, t } = usePrefs();
  if (!me) return null;
  if (me.role !== "admin") return <div className="empty">{t("Admins only.", "Solo administradores.")}</div>;

  // Drivers are derived from the Users list, not stored in settings.
  const drivers = driverNames(users);

  return (
    <>
      <div className="page-head"><h2>{t("Settings", "Ajustes")}</h2></div>

      <div className="card">
        <h2>🌐 {t("Language & appearance", "Idioma y apariencia")}</h2>
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
        <div className="hint">{t("You can also switch these anytime from the buttons in the top bar.", "También puedes cambiarlos desde los botones en la barra superior.")}</div>
      </div>

      <div className="card">
        <h2>{t("Workspace name", "Nombre del espacio")}</h2>
        <AppName current={settings.app_name} saveLabel={t("Save", "Guardar")} onSave={(v) => { saveSettings({ app_name: v }); notify(t("Saved", "Guardado")); }} />
      </div>

      <div className="card">
        <h2>⏱ {t("Duration rates", "Tarifas de duración")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t("Pickup and delivery durations are calculated automatically as", "Las duraciones de recolección y entrega se calculan automáticamente como")}
          <b> {t("pallets × minutes-per-pallet", "tarimas × minutos-por-tarima")}</b>. {t("Set the rates here.", "Configura las tarifas aquí.")}
        </p>
        <div className="grid g2" style={{ maxWidth: 460 }}>
          <RateInput
            label={t("Pickup — minutes per pallet", "Recolección — minutos por tarima")}
            value={settings.pickup_min_per_pallet}
            onSave={(v) => { saveSettings({ pickup_min_per_pallet: v }); notify(t("Saved", "Guardado")); }}
          />
          <RateInput
            label={t("Delivery — minutes per pallet", "Entrega — minutos por tarima")}
            value={settings.delivery_min_per_pallet}
            onSave={(v) => { saveSettings({ delivery_min_per_pallet: v }); notify(t("Saved", "Guardado")); }}
          />
        </div>
        <div className="hint">{t("Example", "Ejemplo")}: 6 {t("pallets", "tarimas")} → {t("pickup", "recolección")} {6 * settings.pickup_min_per_pallet} min, {t("delivery", "entrega")} {6 * settings.delivery_min_per_pallet} min.</div>
      </div>

      <div className="card">
        <h2>📞 {t("RingCentral integration", "Integración RingCentral")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t(
            "These contact customers and use your RingCentral plan, so they stay OFF until you switch them on.",
            "Estas funciones contactan a los clientes y usan su plan de RingCentral, por eso permanecen APAGADAS hasta que las active.",
          )}
        </p>

        <Toggle
          label={t("Click-to-call customers (RingOut)", "Llamar a clientes (RingOut)")}
          desc={t(
            "Shows a “Call via RingCentral” button on orders. Your line rings first, then connects to the customer.",
            "Muestra un botón “Llamar por RingCentral” en las órdenes. Su línea suena primero y luego conecta con el cliente.",
          )}
          on={settings.rc_calls_enabled}
          onChange={(v) => { saveSettings({ rc_calls_enabled: v }); notify(v ? t("Calling enabled", "Llamadas activadas") : t("Calling disabled", "Llamadas desactivadas")); }}
          t={t}
        />

        <Toggle
          label={t("Automatic tracking SMS on new orders", "SMS automático de seguimiento")}
          desc={t(
            "Texts the customer their live tracking link the moment an order is created (only if it has a phone number).",
            "Envía al cliente su enlace de seguimiento en cuanto se crea la orden (solo si tiene teléfono).",
          )}
          on={settings.rc_auto_sms_enabled}
          onChange={(v) => { saveSettings({ rc_auto_sms_enabled: v }); notify(v ? t("Auto-SMS enabled", "SMS automático activado") : t("Auto-SMS disabled", "SMS automático desactivado")); }}
          t={t}
        />

        <div className="hint" style={{ marginTop: 10 }}>
          {t(
            "Manual “Send SMS” / WhatsApp buttons stay available regardless. RingCentral keys are configured in .env.local.",
            "Los botones manuales “Enviar SMS” / WhatsApp siguen disponibles. Las claves de RingCentral se configuran en .env.local.",
          )}
        </div>
      </div>

      <div className="card">
        <h2>⏰ {t("Pending-approval deadline alert", "Alerta de vencimiento de aprobación")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t(
            "Once it's this time of day and an order is still Pending Approval, its row turns red and an escalation notification fires — managers first, then (a bit later) the sales rep who submitted it.",
            "Una vez llegada esta hora del día, si una orden sigue Pendiente de Aprobación, su fila se pone roja y se envía una notificación — primero a los gerentes y, un poco después, al vendedor que la envió.",
          )}
        </p>
        <div className="grid g2" style={{ maxWidth: 460 }}>
          <TimeInput
            label={t("Manager cutoff", "Límite del gerente")}
            value={settings.manager_pending_cutoff ?? "16:00"}
            onSave={(v) => { saveSettings({ manager_pending_cutoff: v }); notify(t("Saved", "Guardado")); }}
          />
          <TimeInput
            label={t("Sales rep cutoff (escalation)", "Límite del vendedor (escalamiento)")}
            value={settings.sales_pending_cutoff ?? "16:15"}
            onSave={(v) => { saveSettings({ sales_pending_cutoff: v }); notify(t("Saved", "Guardado")); }}
          />
        </div>
      </div>

      <div className="card">
        <h2>🔑 {t("Role capabilities", "Capacidades por rol")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
          {t(
            "Shown on each person's Account page under “What I can do”. Defaults are pre-filled — add, remove or reword them per role.",
            "Se muestran en la página Mi cuenta de cada persona en “Lo que puedo hacer”. Los valores por defecto ya están cargados — agregue, quite o reescriba por rol.",
          )}
        </p>
        {ROLE_ORDER.map((r) => (
          <PermissionEditor
            key={r}
            role={r}
            lang={lang}
            items={settings.role_permissions?.[r] ?? defaultPermissions(r, lang)}
            isCustom={!!settings.role_permissions?.[r]?.length}
            onChange={(v) => saveSettings({ role_permissions: { ...(settings.role_permissions ?? {}), [r]: v } } as Partial<Settings>)}
            onReset={() => {
              const next = { ...(settings.role_permissions ?? {}) };
              delete next[r];
              saveSettings({ role_permissions: next } as Partial<Settings>);
              notify(t("Reset to defaults", "Restablecido"));
            }}
            t={t}
          />
        ))}
      </div>

      <div className="card">
        <h2>📋 {t("Sales orders columns", "Columnas de órdenes (Ventas)")}</h2>
        <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>
          {t(
            "Sales reps don't get a Columns picker of their own — this is the one fixed list everyone with that role sees.",
            "Los vendedores no tienen selector de columnas propio — esta es la lista fija que ven todos los que tienen ese rol.",
          )}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          {settings.sales_columns
            ? <button className="notif-clear" onClick={() => { saveSettings({ sales_columns: null }); notify(t("Reset to defaults", "Restablecido")); }}>{t("Reset to defaults", "Restablecer")}</button>
            : <span className="hint">{t("(defaults)", "(por defecto)")}</span>}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 2, maxWidth: 620 }}>
          {ORDER_COLUMNS.map((c) => {
            const active = settings.sales_columns ?? ROLE_DEFAULT_COLUMNS.sales ?? DEFAULT_COLUMNS;
            const checked = active.includes(c.key);
            return (
              <label key={c.key} className="col-opt">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => saveSettings({ sales_columns: checked ? active.filter((k) => k !== c.key) : [...active, c.key] })}
                />
                {lang === "es" ? c.es : c.en}
              </label>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>🗂 {t("Stores, pickup points & order types", "Tiendas, puntos de recolección y tipos")}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t(
            "The lists the order form pulls from — stores, saved pickup points, dropoff sites and order types — now live on the Data page, where they can be edited and removed.",
            "Las listas que usa el formulario — tiendas, puntos de recolección, sitios de entrega y tipos de orden — ahora están en la página Datos, donde se pueden editar y eliminar.",
          )}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <Link href="/data" className="btn btn-primary">🗂 {t("Open Data", "Abrir Datos")}</Link>
          <span className="hint">
            {settings.stores.length} {t("stores", "tiendas")} ·{" "}
            {(settings.pickup_locations?.length ?? 0)} {t("pickup points", "puntos de recolección")} ·{" "}
            {(settings.delivery_locations?.length ?? 0)} {t("dropoff sites", "sitios de entrega")} ·{" "}
            {settings.order_types.length} {t("order types", "tipos")}
          </span>
        </div>
      </div>

      <div className="card">
        <h2>🚚 {t("Drivers", "Choferes")}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t(
            "Drivers are people, so they're managed with everyone else in Users — give someone the Driver role and they'll appear in the Assigned Driver list automatically.",
            "Los choferes son personas, así que se gestionan junto con los demás en Usuarios — asigne el rol de Chofer y aparecerá automáticamente en la lista de Chofer Asignado.",
          )}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <Link href="/users" className="btn btn-primary">🛡 {t("Manage users", "Gestionar usuarios")}</Link>
          <span className="hint">
            {drivers.length
              ? `${drivers.length} ${t("driver(s)", "chofer(es)")}: ${drivers.join(", ")}`
              : t("No one has the Driver role yet.", "Nadie tiene el rol de Chofer todavía.")}
          </span>
        </div>
      </div>
    </>
  );
}

function AppName({ current, onSave, saveLabel }: { current: string; onSave: (v: string) => void; saveLabel: string }) {
  const [v, setV] = useState(current);
  return (
    <div style={{ display: "flex", gap: 8, maxWidth: 460 }}>
      <input value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn btn-primary" onClick={() => onSave(v.trim() || current)}>{saveLabel}</button>
    </div>
  );
}

/** Per-role capability list. Starts pre-filled with the built-in defaults; the
 * first edit saves an override for that role (resettable). */
function PermissionEditor({
  role, lang, items, isCustom, onChange, onReset, t,
}: {
  role: UserRole;
  lang: "en" | "es";
  items: string[];
  isCustom: boolean;
  onChange: (v: string[]) => void;
  onReset: () => void;
  t: (en: string, es: string) => string;
}) {
  const [val, setVal] = useState("");
  const add = () => {
    const v = val.trim();
    if (!v || items.includes(v)) { setVal(""); return; }
    onChange([...items, v]);
    setVal("");
  };
  const remove = (x: string) => onChange(items.filter((i) => i !== x));
  const info = ROLE_INFO[role];

  return (
    <div className="perm-block">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <span className="sema" style={{ background: info.color, color: "#fff" }}>{roleLabel(role, lang)}</span>
        {isCustom
          ? <button className="notif-clear" onClick={onReset}>{t("Reset to defaults", "Restablecer")}</button>
          : <span className="hint">{t("(defaults)", "(por defecto)")}</span>}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, maxWidth: 460 }}>
        <input
          value={val}
          placeholder={t("Add a capability…", "Agregar una capacidad…")}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn btn-primary" onClick={add} disabled={!val.trim()}>{t("Add", "Agregar")}</button>
      </div>
      <div className="pill-list">
        {items.length === 0 && <span className="hint">{t("Nothing listed for this role.", "Nada listado para este rol.")}</span>}
        {items.map((x) => (
          <span className="pill-item" key={x}>
            ✓ {x}
            <button onClick={() => remove(x)} title={t("Remove", "Quitar")}>✕</button>
          </span>
        ))}
      </div>
    </div>
  );
}

/** On/off switch for an opt-in integration. */
function Toggle({
  label, desc, on, onChange, t,
}: {
  label: string;
  desc: string;
  on: boolean;
  onChange: (v: boolean) => void;
  t: (en: string, es: string) => string;
}) {
  return (
    <div className="setting-row">
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
        <div className="hint" style={{ marginTop: 2 }}>{desc}</div>
      </div>
      <div className="toggle-group" style={{ flex: "0 0 auto" }}>
        <button className={"toggle-btn " + (!on ? "on" : "")} onClick={() => onChange(false)}>{t("Off", "Apagado")}</button>
        <button className={"toggle-btn " + (on ? "on" : "")} onClick={() => onChange(true)}>{t("On", "Encendido")}</button>
      </div>
    </div>
  );
}

function TimeInput({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const commit = () => { if (v && v !== value) onSave(v); else setV(value); };
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="time" value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
      />
    </div>
  );
}

function RateInput({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  const commit = () => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) { setV(String(value)); return; }
    if (n !== value) onSave(n);
  };
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number" min={0} step="0.5" value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}

