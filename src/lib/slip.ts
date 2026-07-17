import type { Delivery, Profile, Settings } from "@/lib/types";
import type { Lang } from "@/lib/prefs";
import { stageLabel } from "@/lib/constants";
import { fmtDate, fmtDateTime, fmtMilitary, fmtMoney } from "@/lib/utils";

// ============================================================
// Printable delivery slip / packing list for a single order (#20).
// Opens a clean print window → the browser's "Save as PDF" or a physical
// printer. Self-contained HTML, no dependencies. Bilingual.
// ============================================================

export function printDeliverySlip(d: Delivery, settings: Settings, users: Profile[], lang: Lang) {
  const T = (en: string, es: string) => (lang === "es" ? es : en);
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.full_name ?? "—";
  const storeAddr = settings.stores.find((s) => s.name === d.store)?.address || d.pickup_address || "";

  const row = (label: string, value: string) =>
    `<tr><th>${esc(label)}</th><td>${esc(value || "—")}</td></tr>`;

  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">
    <title>${esc(settings.app_name)} — ${T("Slip", "Comprobante")} #${d.order_no}</title>
    <style>
      *{box-sizing:border-box;} body{font-family:Inter,Arial,sans-serif;color:#152238;margin:0;padding:28px;}
      .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #152238;padding-bottom:14px;margin-bottom:18px;}
      .brand{font-size:22px;font-weight:800;} .brand span{color:#e9a13b;}
      .ono{font-size:30px;font-weight:800;font-family:Archivo,Arial,sans-serif;text-align:right;}
      .stage{display:inline-block;background:#152238;color:#fff;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:700;margin-top:4px;}
      h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#6b7686;margin:18px 0 6px;}
      table{width:100%;border-collapse:collapse;margin-bottom:6px;}
      th{width:210px;text-align:left;vertical-align:top;color:#6b7686;font-weight:600;font-size:13px;padding:5px 10px 5px 0;}
      td{font-size:13px;font-weight:600;padding:5px 0;border-bottom:1px solid #eef1f6;}
      .cols{display:flex;gap:30px;} .cols>div{flex:1;}
      .notes{border:1px solid #dfe5ee;border-radius:8px;padding:10px 12px;min-height:52px;font-size:13px;}
      .sign{display:flex;gap:30px;margin-top:36px;}
      .sign>div{flex:1;border-top:1px solid #152238;padding-top:6px;font-size:12px;color:#6b7686;}
      .pod{display:flex;gap:24px;align-items:flex-end;margin-top:4px;}
      .pod-info{flex:1;} .pod-info th{width:120px;}
      .pod-sig{flex:1;} .pod-sig-label{font-size:12px;color:#6b7686;margin-bottom:4px;}
      .pod-sig img{max-height:110px;max-width:100%;border:1px solid #dfe5ee;border-radius:8px;background:#fff;}
      .pod-sig-empty{border:1px dashed #dfe5ee;border-radius:8px;padding:20px;text-align:center;color:#9aa3b0;font-size:12px;}
      .foot{margin-top:26px;font-size:11px;color:#9aa3b0;text-align:center;}
      @media print{body{padding:12px;}}
    </style></head><body>
    <div class="head">
      <div>
        <div class="brand">${esc(settings.app_name)}</div>
        <div style="font-size:12px;color:#6b7686;margin-top:4px;">${T("Delivery slip", "Comprobante de entrega")}</div>
      </div>
      <div>
        <div class="ono">#${d.order_no}</div>
        <div class="stage">${esc(stageLabel(d.stage, lang))}</div>
      </div>
    </div>

    <div class="cols">
      <div>
        <h2>${T("Pickup", "Recolección")}</h2>
        <table>
          ${row(T("Store", "Tienda"), d.store || "")}
          ${row(T("Pickup name", "Nombre"), d.pickup_name || "")}
          ${row(T("Pickup address", "Dirección"), d.pickup_address || storeAddr)}
        </table>
      </div>
      <div>
        <h2>${T("Delivery", "Entrega")}</h2>
        <table>
          ${row(T("Account", "Cuenta"), d.account || "")}
          ${row(T("Contact", "Contacto"), d.contact || "")}
          ${row(T("Phone", "Teléfono"), d.delivery_phone || "")}
          ${row(T("Address", "Dirección"), d.delivery_address || "")}
        </table>
      </div>
    </div>

    <h2>${T("Order", "Orden")}</h2>
    <div class="cols"><div><table>
      ${row(T("Type", "Tipo"), d.order_type || "")}
      ${row(T("SO #", "SO #"), d.so_num || "")}
      ${row(T("PO #2", "PO #2"), d.po2 || "")}
      ${row(T("Invoice #", "Factura #"), d.invoice_num || "")}
    </table></div><div><table>
      ${row(T("Delivery date", "Fecha entrega"), d.delivery_date ? fmtDate(d.delivery_date) : "")}
      ${row(T("Windows", "Ventanas"), d.delivery_windows || "")}
      ${row(T("Pallets", "Tarimas"), String(d.actual_pallets ?? d.est_pallets ?? ""))}
      ${row(T("Delivery fee", "Costo de entrega"), d.delivery_fee == null ? "" : fmtMoney(d.delivery_fee))}
      ${row(T("Driver", "Chofer"), d.assigned_driver || "")}
    </table></div></div>

    <h2>${T("Delivery notes", "Notas de entrega")}</h2>
    <div class="notes">${esc(d.delivery_notes || "")}</div>

    ${d.pod_received_by ? `
    <h2>${T("Proof of delivery", "Comprobante de entrega")}</h2>
    <div class="pod">
      <div class="pod-info">
        <table>
          ${row(T("Received by", "Recibido por"), d.pod_received_by || "")}
          ${row(T("Delivered", "Entregado"), d.pod_delivered_at ? fmtDateTime(d.pod_delivered_at) : "")}
          ${d.pod_lat != null && d.pod_lng != null
            ? row(T("GPS location", "Ubicación GPS"), `${d.pod_lat}, ${d.pod_lng}${d.pod_accuracy != null ? ` (±${d.pod_accuracy} m)` : ""}`)
            : ""}
        </table>
      </div>
      <div class="pod-sig">
        <div class="pod-sig-label">${T("Signature", "Firma")}</div>
        ${d.pod_signature
          ? `<img src="${d.pod_signature}" alt="signature" />`
          : `<div class="pod-sig-empty">${T("(no signature captured)", "(sin firma capturada)")}</div>`}
      </div>
    </div>` : `
    <div class="sign">
      <div>${T("Received by (print name)", "Recibido por (nombre)")}</div>
      <div>${T("Signature", "Firma")}</div>
      <div>${T("Date / time", "Fecha / hora")}</div>
    </div>`}

    <div class="foot">
      ${T("Created by", "Creado por")} ${esc(nameOf(d.created_by))} ·
      ${T("Input", "Ingreso")} ${esc(d.input_date || "")} ${esc(fmtMilitary(d.input_time))} ·
      ${T("Printed", "Impreso")} ${new Date().toLocaleString(lang === "es" ? "es" : "en-US")}
    </div>
    <script>
      // Wait for the signature image (a data: URL) to finish decoding before
      // printing, otherwise it can be omitted from the generated PDF.
      window.onload=function(){
        var imgs=[].slice.call(document.images);
        var pending=imgs.filter(function(i){return !i.complete;});
        var done=function(){setTimeout(function(){window.print();},200);};
        if(!pending.length){done();return;}
        var left=pending.length;
        pending.forEach(function(i){
          var fin=function(){if(--left<=0)done();};
          i.addEventListener('load',fin);i.addEventListener('error',fin);
        });
        setTimeout(done,1500); // safety net
      };
    </script>
    </body></html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
