"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { LeafletMap, type MapPoint } from "@/components/LeafletMap";

// ============================================================
// Market Map — a live view of the flooring market across Hidalgo + Cameron
// counties, pulled in real time from OpenStreetMap (via /api/places), not a
// static list. Rodriguez Tile Group locations stand out in blue; competitors
// red; big-box secondary sellers (Home Depot / Lowe's) orange; hardware /
// building-supply partnership prospects green.
// ============================================================

type Klass = "rtg" | "competitor" | "bigbox" | "hardware";

interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  shop: string | null;
  brand: string | null;
  city: string | null;
  phone: string | null;
}

const COLORS: Record<Klass, string> = {
  rtg: "#2456c9",        // blue — us
  competitor: "#d64545", // red — dedicated flooring competitors
  bigbox: "#d1782e",     // orange — big-box secondary sellers
  hardware: "#1f9d61",   // green — hardware / prospects
};

function classify(p: Place): Klass {
  const n = p.name.toLowerCase();
  const b = (p.brand ?? "").toLowerCase();
  if (n.includes("rodriguez tile") || b.includes("rodriguez tile")) return "rtg";
  if (n.includes("home depot") || n.includes("lowe") || p.shop === "doityourself") return "bigbox";
  if (["hardware", "trade", "building_materials", "paint"].includes(p.shop ?? "")) return "hardware";
  return "competitor";
}

export default function MarketPage() {
  const { me } = useData();
  const { t } = usePrefs();
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [show, setShow] = useState<Record<Klass, boolean>>({ rtg: true, competitor: true, bigbox: true, hardware: true });

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      // Sequential (not parallel) so the free Overpass service doesn't rate-limit us.
      const cats = ["flooring", "bigbox", "hardware"];
      const byId = new Map<string, Place>();
      let anyOk = false;
      for (const c of cats) {
        const r = await fetch(`/api/places?category=${c}`).then((res) => res.json()).catch(() => ({ error: "fetch" }));
        if (!r.error) anyOk = true;
        for (const p of (r.places ?? []) as Place[]) byId.set(p.id, p);
        setPlaces([...byId.values()]); // progressive: show each layer as it lands
      }
      if (!anyOk) setErr(t("Couldn't reach the live places service. Try Refresh.", "No se pudo consultar el servicio en vivo. Use Actualizar."));
    } catch {
      setErr(t("Network error — try again.", "Error de red — intente de nuevo."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const classed = useMemo(() => places.map((p) => ({ ...p, klass: classify(p) })), [places]);
  const counts = useMemo(() => {
    const c: Record<Klass, number> = { rtg: 0, competitor: 0, bigbox: 0, hardware: 0 };
    for (const p of classed) c[p.klass]++;
    return c;
  }, [classed]);

  const shown = useMemo(() => classed.filter((p) => show[p.klass]), [classed, show]);

  const points: MapPoint[] = useMemo(
    () => shown.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      color: COLORS[p.klass],
      label: `${p.name}${p.city ? ` — ${p.city}` : ""}${p.phone ? ` — ${p.phone}` : ""}`,
    })),
    [shown],
  );
  const fitTo = useMemo<[number, number][]>(() => points.map((p) => [p.lat, p.lng] as [number, number]), [points]);

  const legend: { k: Klass; en: string; es: string }[] = [
    { k: "rtg", en: "Rodriguez Tile Group", es: "Rodriguez Tile Group" },
    { k: "competitor", en: "Flooring competitors", es: "Competidores de pisos" },
    { k: "bigbox", en: "Big-box (also sell flooring)", es: "Grandes tiendas (también venden pisos)" },
    { k: "hardware", en: "Hardware / prospects", es: "Ferreterías / prospectos" },
  ];

  if (!me) return null;
  if (!["admin", "manager", "sales"].includes(me.role)) {
    return <div className="empty">{t("Not available for your role.", "No disponible para su rol.")}</div>;
  }

  return (
    <>
      <div className="page-head">
        <h2>{t("Market Map", "Mapa de Mercado")} <span className="count-tag">{classed.length}</span></h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {legend.map((l) => (
            <button
              key={l.k}
              className={"btn btn-sm " + (show[l.k] ? "btn-primary" : "btn-ghost")}
              onClick={() => setShow((s) => ({ ...s, [l.k]: !s[l.k] }))}
              title={t("Toggle on the map", "Mostrar/ocultar en el mapa")}
            >
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: COLORS[l.k], marginRight: 6, verticalAlign: "middle", boxShadow: "0 0 0 1px var(--line)" }} />
              {t(l.en, l.es)} ({counts[l.k]})
            </button>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={load} disabled={loading}>
            {loading ? `… ${t("Loading", "Cargando")}` : `↻ ${t("Refresh (live)", "Actualizar (en vivo)")}`}
          </button>
        </div>
      </div>

      <p className="hint" style={{ marginTop: -6 }}>
        {t(
          "Live from OpenStreetMap across Hidalgo & Cameron counties — reflects what's mapped there today, and grows as more is added.",
          "En vivo desde OpenStreetMap en los condados de Hidalgo y Cameron — refleja lo que está mapeado hoy y crece a medida que se agrega más.",
        )}
      </p>

      {err && <div className="card" style={{ borderColor: "var(--red)" }}>{err}</div>}

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <LeafletMap points={points} fitTo={fitTo.length ? fitTo : undefined} height={520} />
      </div>

      <div className="card">
        <h2>📋 {t("Companies", "Empresas")} <span className="count-tag">{shown.length}</span></h2>
        {loading ? (
          <div className="empty">{t("Loading live data…", "Cargando datos en vivo…")}</div>
        ) : shown.length === 0 ? (
          <div className="empty">{t("No companies to show. Toggle a category on, or refresh.", "Nada que mostrar. Active una categoría o actualice.")}</div>
        ) : (
          <div className="tbl-scroll" style={{ border: "none" }}>
            <table className="orders" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>{t("Company", "Empresa")}</th>
                  <th>{t("Type", "Tipo")}</th>
                  <th>{t("City", "Ciudad")}</th>
                  <th>{t("Phone", "Teléfono")}</th>
                </tr>
              </thead>
              <tbody>
                {[...shown].sort((a, b) => a.name.localeCompare(b.name)).map((p) => {
                  const l = legend.find((x) => x.k === p.klass)!;
                  return (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 700 }}>
                        <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: COLORS[p.klass], marginRight: 7, verticalAlign: "middle" }} />
                        {p.name}
                      </td>
                      <td>{t(l.en, l.es)}</td>
                      <td>{p.city || "—"}</td>
                      <td>{p.phone ? <a className="link-tel" href={`tel:${p.phone}`}>{p.phone}</a> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
