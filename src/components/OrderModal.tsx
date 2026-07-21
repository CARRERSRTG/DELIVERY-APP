"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { useConfirm } from "@/lib/confirm";
import { canApprove, canCreate, canDeliver, canEditFields, canFulfill, DELIVERY_WINDOW_PRESETS, driverNames, stageInfo, stageLabel } from "@/lib/constants";
import { colLabel, deliveryColumns, fmtDate, fmtDateTime, fmtMilitary, nowMilitary, palletDuration, telClean, todayISO } from "@/lib/utils";
import { printDeliverySlip } from "@/lib/slip";
import { AddressInput } from "@/components/AddressInput";
import { LocationCombo } from "@/components/LocationCombo";
import { PhotoUpload } from "@/components/PhotoUpload";
import { SignaturePad } from "@/components/SignaturePad";
import { LeafletMap } from "@/components/LeafletMap";
import { suggestDriver, windowConflicts } from "@/lib/dispatch";
import { checkSchedule } from "@/lib/scheduling";
import { isIntraStore as isIntraTienda, missingFields, missingKeys, type MissingField } from "@/lib/required";
import { captureLocation, geoAvailable, mapLink } from "@/lib/geo";
import type { AccountRecord, Delivery, NamedLocation, Profile, Settings, Stage } from "@/lib/types";

type Draft = Partial<Delivery>;

// A new order starts with NO order type. It decides which paperwork is
// required (Intra-Tienda / Pickup / Transfer differ), so it has to be a
// deliberate choice — defaulting it to "Delivery" silently picked for the rep
// and meant the required-field highlight could never fire.
const EMPTY: Draft = {
  stage: "draft",
  input_date: todayISO(),
};

// Standard cancellation reasons (#10) — a fixed pick-list keeps the data clean
// for the end-of-week review, mirroring how rejections capture a reason.
const CANCEL_REASONS: { en: string; es: string }[] = [
  { en: "Customer canceled", es: "Cliente canceló" },
  { en: "Duplicate order", es: "Orden duplicada" },
  { en: "Out of stock", es: "Sin existencias" },
  { en: "Rescheduled", es: "Reprogramada" },
  { en: "Wrong information", es: "Información incorrecta" },
  { en: "Other", es: "Otro" },
];

/** Create / edit / view a delivery order with role-gated fields + workflow actions. */
export function OrderModal({
  me,
  existing,
  startEditing,
  onClose,
}: {
  me: Profile;
  existing: Delivery | null;
  startEditing: boolean;
  onClose: () => void;
}) {
  const { settings, users, deliveries, addDelivery, updateDelivery, deleteDelivery, setStage, eventsFor, addNote, saveSettings, notify } =
    useData();
  const { lang, t } = usePrefs();
  const confirmAction = useConfirm();
  const isNew = !existing;
  const stage: Stage = existing?.stage ?? "draft";
  const editable = isNew || (startEditing && canEditFields(me.role, stage));
  const [editing, setEditing] = useState(editable);
  const [d, setD] = useState<Draft>(existing ?? EMPTY);
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [redeliverReason, setRedeliverReason] = useState("");
  const [showRedeliver, setShowRedeliver] = useState(false);
  const [routing, setRouting] = useState(false);
  const [routeErr, setRouteErr] = useState("");
  const [showPod, setShowPod] = useState(false);
  const [podName, setPodName] = useState("");
  const [podSig, setPodSig] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [notingBusy, setNotingBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [showPinPicker, setShowPinPicker] = useState(false);
  const [pinDraft, setPinDraft] = useState<[number, number] | null>(null);
  const [pinLookupBusy, setPinLookupBusy] = useState(false);
  // After a successful delivery we keep the modal open on a success screen so the
  // driver can print the slip; holds the fully-updated (delivered) order.
  const [justDelivered, setJustDelivered] = useState<Delivery | null>(null);

  const events = existing ? eventsFor(existing.id) : [];
  const userName = (id: string | null | undefined) =>
    users.find((u) => u.id === id)?.full_name ?? "—";

  const set = (k: keyof Delivery, v: unknown) => setD((p) => ({ ...p, [k]: v }));

  // A non-sales creator (office, admin, driver) is placing the order on behalf
  // of a sales rep, so it needs to be assigned to one — that's who the order
  // shows up "owned by" everywhere else (own-orders filters, dashboard credit).
  const needsSalesRep = isNew && (me.role === "manager" || me.role === "admin" || me.role === "driver");
  const salesReps = useMemo(() => users.filter((u) => u.role === "sales"), [users]);

  // ---- Required fields (#31) — see lib/required.ts for the rules ----
  // Live list of what's still missing, used to highlight the empty fields.
  const computeMissing = (draft: Draft): MissingField[] => {
    const base = missingFields(draft);
    if (needsSalesRep && !draft.assigned_sales_rep) {
      return [...base, { key: "assigned_sales_rep", en: "Sales Rep", es: "Vendedor" }];
    }
    return base;
  };
  const missing = computeMissing(d);
  const missingSet = new Set(missingKeys(d));
  if (needsSalesRep && !d.assigned_sales_rep) missingSet.add("assigned_sales_rep");

  // ---- Duplicate-order warning (#34): same account + date + PO already logged ----
  const duplicateOf = (draft: Draft): Delivery | undefined =>
    deliveries.find((x) =>
      x.id !== existing?.id &&
      x.stage !== "canceled" &&
      !!draft.account && (x.account || "").trim().toLowerCase() === draft.account.trim().toLowerCase() &&
      (draft.delivery_date || "") === (x.delivery_date || "") &&
      (draft.po2 || "").trim() === (x.po2 || "").trim() &&
      !!(draft.po2 || "").trim(),
    );

  // ---- Duplicate-invoice warning: same customer invoice # already logged on
  // another (non-canceled) order. Invoice numbers are supposed to be unique
  // per delivery, so this is almost always a typo or a re-entry mistake. ----
  const duplicateInvoiceOf = (draft: Draft): Delivery | undefined =>
    deliveries.find((x) =>
      x.id !== existing?.id &&
      x.stage !== "canceled" &&
      !!(draft.invoice_num || "").trim() &&
      (x.invoice_num || "").trim().toLowerCase() === (draft.invoice_num || "").trim().toLowerCase(),
    );
  const invoiceDup = duplicateInvoiceOf(d);

  /** Shared pre-submit gate. Nothing hard-blocks — the rep is told exactly
   * what's missing / conflicting and chooses whether to continue. */
  const passesChecks = async (draft: Draft): Promise<boolean> => {
    // 1. Required fields — list them and let the rep decide.
    const miss = computeMissing(draft);
    if (miss.length) {
      const list = miss.map((m) => `• ${t(m.en, m.es)}`).join("\n");
      if (!(await confirmAction(t(
        `These required fields are still empty:\n\n${list}\n\nContinue anyway?`,
        `Estos campos obligatorios están vacíos:\n\n${list}\n\n¿Continuar de todos modos?`,
      )))) return false;
    }
    const dup = duplicateOf(draft);
    if (dup && !(await confirmAction(t(
      `Order #${dup.order_no} already has the same account, delivery date and PO. Create anyway?`,
      `La orden #${dup.order_no} ya tiene la misma cuenta, fecha y PO. ¿Crear de todos modos?`,
    )))) return false;

    const dupInv = duplicateInvoiceOf(draft);
    if (dupInv && !(await confirmAction(t(
      `⚠ Duplicate invoice: order #${dupInv.order_no} already uses invoice #${dupInv.invoice_num}. Create anyway?`,
      `⚠ Factura duplicada: la orden #${dupInv.order_no} ya usa la factura #${dupInv.invoice_num}. ¿Crear de todos modos?`,
    )))) return false;

    // Scheduling capacity rules — warn, but let the rep request it anyway.
    const warns = checkSchedule(
      { id: existing?.id, store: draft.store, delivery_date: draft.delivery_date, delivery_windows: draft.delivery_windows },
      deliveries,
    );
    if (warns.length) {
      const list = warns.map((w) => `• ${t(w.en, w.es)}`).join("\n");
      if (!(await confirmAction(t(`⚠ Scheduling conflict:\n\n${list}\n\nRequest anyway?`, `⚠ Conflicto de programación:\n\n${list}\n\n¿Solicitar de todos modos?`)))) return false;
    }
    return true;
  };

  // Live scheduling warnings shown while editing the date/window.
  const scheduleWarnings = checkSchedule(
    { id: existing?.id, store: d.store, delivery_date: d.delivery_date, delivery_windows: d.delivery_windows },
    deliveries,
  );

  // Durations are auto-derived from pallet count × the admin-set per-pallet rates.
  const pickupDur = palletDuration(d.est_pallets, settings.pickup_min_per_pallet);
  const deliveryDur = palletDuration(d.est_pallets, settings.delivery_min_per_pallet);

  /** Merge computed durations into a payload; stamp input date/time on creation. */
  const withDurations = (base: Draft): Draft => {
    const payload: Draft = { ...base, pickup_duration: pickupDur, delivery_duration: deliveryDur };
    if (payload.est_pallets === ("" as unknown)) payload.est_pallets = null;
    // Input date + time are recorded automatically the moment the order is created.
    if (isNew) {
      payload.input_date = todayISO();
      payload.input_time = nowMilitary();
    }
    return payload;
  };

  // Automatically text the customer their live tracking link when an order is
  // created. No-ops silently if there's no phone or SMS isn't configured.
  const autoSendTracking = async (row: Delivery) => {
    // Opt-in only: admins switch this on in Settings (off by default).
    if (!settings.rc_auto_sms_enabled) return;
    const phone = telClean(row.delivery_phone);
    if (phone.replace(/\D/g, "").length < 7) return;
    const url = `${location.origin}/track/${row.id}`;
    const who = row.contact ? `${row.contact}, ` : "";
    const date = row.delivery_date ? fmtDate(row.delivery_date) : "";
    const win = row.delivery_windows ? ` ${row.delivery_windows}` : "";
    const message = t(
      `Hi ${who}your RDZ delivery #${row.order_no} is scheduled${date ? ` for ${date}${win}` : ""}. Track it live here: ${url}`,
      `Hola ${who}su entrega RDZ #${row.order_no} está programada${date ? ` para el ${date}${win}` : ""}. Siga su estado aquí: ${url}`,
    );
    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "sms", to: phone, message }),
      });
      const b = await res.json().catch(() => ({}));
      if (b.ok) notify(t("Tracking SMS sent to customer", "SMS de seguimiento enviado al cliente"));
    } catch { /* non-blocking */ }
  };

  const save = async () => {
    const payload = withDurations(d);
    // Enforce required fields once an order is past the draft stage.
    if ((payload.stage ?? "draft") !== "draft" && !(await passesChecks(payload))) return;
    setBusy(true);
    if (isNew) {
      const row = await addDelivery(payload);
      setBusy(false);
      if (row) { notify(t(`Order #${row.order_no} created`, `Orden #${row.order_no} creada`)); await autoSendTracking(row); onClose(); }
    } else {
      const ok = await updateDelivery(existing!.id, payload);
      setBusy(false);
      if (ok) { notify(t("Saved", "Guardado")); setEditing(false); }
    }
  };

  // Remembers the last origin→destination pair we routed, so the auto-calc
  // effect doesn't re-fire for an address that's already been resolved.
  const lastRouted = useRef<string>("");

  const runRoute = async (origin: string, destination: string, manual: boolean) => {
    if (!origin) { if (manual) setRouteErr(t("Add a pickup address (or store) first.", "Agregue primero una dirección de recolección (o tienda).")); return; }
    if (!destination) { if (manual) setRouteErr(t("Add a delivery address first.", "Agregue primero una dirección de entrega.")); return; }
    setRouteErr("");
    lastRouted.current = `${origin}→${destination}`;
    setRouting(true);
    try {
      const res = await fetch("/api/distance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination }),
      });
      const body = await res.json();
      if (!res.ok) {
        // Let a manual retry re-run this pair.
        lastRouted.current = "";
        if (manual) setRouteErr(body.error || t("Could not calculate route.", "No se pudo calcular la ruta."));
        return;
      }
      setD((p) => ({
        ...p,
        route_miles: body.miles,
        route_duration: body.duration_text,
        route_provider: body.provider,
        route_traffic: body.traffic,
      }));
    } catch {
      lastRouted.current = "";
      if (manual) setRouteErr(t("Network error — is the machine online?", "Error de red — ¿la máquina está en línea?"));
    } finally {
      setRouting(false);
    }
  };

  // Intra-store (store-to-store) transfer: the delivery destination is another
  // known store, chosen from the dropdown. Matches order types named like
  // "Transfer" or "Intra-Tienda" (admin-configurable, keyword-detected).
  const isIntraStore = /transfer|intra/i.test(d.order_type || "");
  // Intra-Tienda specifically (not Transfer): no external customer is
  // involved, so account/contact/phone don't apply and are locked.
  const intraTienda = isIntraTienda(d.order_type);
  // Which store the current delivery address belongs to (for the dropdown value).
  const deliveryStore = settings.stores.find((s) => s.address && s.address === d.delivery_address)?.name || "";

  // Routing origin: an explicit pickup address wins; otherwise fall back to the
  // selected store's saved (map-searchable) address, then its bare name.
  const storeAddress = settings.stores.find((s) => s.name === d.store)?.address || "";
  const routeOrigin = (d.pickup_address || storeAddress || d.store || "").trim();

  const calcRoute = () =>
    runRoute(routeOrigin, (d.delivery_address || "").trim(), true);

  // Dropping a manual pin also fills in Delivery Address from a reverse
  // geocode of that point, so the field isn't left blank — the rep can
  // still edit it by hand afterward (e.g. to add gate code instructions).
  const savePin = async (lat: number, lng: number) => {
    set("delivery_lat", lat); set("delivery_lng", lng); set("delivery_pin_source", "manual");
    setShowPinPicker(false);
    setPinLookupBusy(true);
    try {
      const res = await fetch("/api/reverse-geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      if (res.ok) {
        const body = await res.json();
        if (body.address) set("delivery_address", body.address);
      }
    } catch { /* best-effort — the pin itself is already saved either way */ }
    setPinLookupBusy(false);
  };

  // Auto-calculate the route as soon as both ends of the trip are known.
  // Debounced so we route once the user stops typing, and skipped if this
  // exact address pair was already resolved.
  useEffect(() => {
    if (!editing) return;
    const origin = routeOrigin;
    const destination = (d.delivery_address || "").trim();
    if (!origin || !destination) return;
    if (`${origin}→${destination}` === lastRouted.current) return;
    const timer = setTimeout(() => runRoute(origin, destination, false), 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, d.pickup_address, d.store, d.delivery_address]);

  const move = async (to: Stage, note?: string) => {
    if (!existing) return;
    setBusy(true);
    // Stamp the driver's location when they collect the load (never blocks).
    let extra: Partial<Delivery> | undefined;
    if (to === "picked_up") {
      const gps = await captureLocation();
      if (gps) extra = { pickup_lat: gps.lat, pickup_lng: gps.lng, pickup_gps_at: gps.at };
    }
    const ok = await setStage(existing.id, to, note, extra);
    setBusy(false);
    if (ok) { notify(t(`Moved to ${stageLabel(to, lang)}`, `Movido a ${stageLabel(to, lang)}`)); onClose(); }
  };

  // Proof of delivery: stamp the signer + signature, then move to delivered.
  const deliverWithPod = async () => {
    if (!existing) return;
    if (!podName.trim()) { notify(t("Enter who received the delivery.", "Ingrese quién recibió la entrega.")); return; }
    setBusy(true);
    // Stamp where the driver actually is. Never blocks: resolves to null if the
    // device refuses, has no signal, or the page isn't served over HTTPS.
    const gps = await captureLocation();
    const pod = {
      pod_received_by: podName.trim(),
      pod_signature: podSig,
      pod_delivered_at: new Date().toISOString(),
      pod_lat: gps?.lat ?? null,
      pod_lng: gps?.lng ?? null,
      pod_accuracy: gps?.accuracy ?? null,
    };
    // Persist POD fields + the stage move in ONE write so nothing clobbers them.
    const ok = await setStage(existing.id, "delivered", t(`Received by ${podName.trim()}`, `Recibido por ${podName.trim()}`), pod);
    setBusy(false);
    if (ok) {
      notify(t("Delivered — proof captured", "Entregado — comprobante guardado"));
      // Keep the dialog open on a success screen so the driver can print the slip.
      setShowPod(false);
      setJustDelivered({ ...existing, stage: "delivered", ...pod, updated_at: new Date().toISOString() });
    }
  };

  // Auto-assign suggestion (#6): least-loaded driver across active orders.
  const suggestAndSet = () => {
    const name = suggestDriver(driverNames(users), deliveries);
    if (name) { set("assigned_driver", name); notify(t(`Suggested: ${name}`, `Sugerido: ${name}`)); }
    else notify(t("No drivers configured.", "No hay choferes configurados."));
  };

  // Window conflict (#5): other active orders with the same driver + date + overlapping window.
  const conflicts = (existing || d.assigned_driver)
    ? windowConflicts({ id: existing?.id, assigned_driver: d.assigned_driver, delivery_date: d.delivery_date, delivery_windows: d.delivery_windows }, deliveries)
    : [];

  const remove = async () => {
    if (!existing) return;
    if (!(await confirmAction(
      t(`Delete order #${existing.order_no}? This cannot be undone.`, `¿Eliminar la orden #${existing.order_no}? No se puede deshacer.`),
      { danger: true, confirmLabel: t("Delete", "Eliminar") },
    ))) return;
    await deleteDelivery(existing.id);
    notify(t("Order deleted", "Orden eliminada"));
    onClose();
  };

  // Log a repeat delivery (warehouse error, damage, etc.) as a NEW order linked
  // to this one, re-entering the flow as "approved" for the warehouse to redo.
  // The link + reason make repeats measurable for the end-of-week review.
  const recordRedelivery = async () => {
    if (!existing || !redeliverReason.trim()) return;
    setBusy(true);
    const src = existing;
    const payload: Draft = {
      // sales/customer data carries over
      order_type: src.order_type, store: src.store, account: src.account,
      po2: src.po2, so_num: src.so_num, invoice_num: src.invoice_num,
      est_pallets: src.est_pallets, delivery_date: src.delivery_date,
      delivery_windows: src.delivery_windows, pickup_address: src.pickup_address,
      pickup_duration: src.pickup_duration, delivery_duration: src.delivery_duration,
      delivery_address: src.delivery_address, contact: src.contact,
      delivery_phone: src.delivery_phone, delivery_notes: src.delivery_notes,
      route_miles: src.route_miles, route_duration: src.route_duration,
      route_provider: src.route_provider, route_traffic: src.route_traffic,
      // warehouse redoes these
      prepared_status: null, status_temp: null, actual_pallets: null, assigned_driver: src.assigned_driver,
      // re-delivery linkage
      stage: "approved", redelivery_of: src.id, redelivery_reason: redeliverReason.trim(),
    };
    const row = await addDelivery(payload);
    setBusy(false);
    if (row) { notify(t(`Re-delivery logged as #${row.order_no}`, `Reentrega registrada como #${row.order_no}`)); onClose(); }
  };

  // Clone this order into a fresh draft (repeat customers, standing orders).
  // Copies the customer/order data, resets all workflow + fulfillment fields.
  const duplicate = async () => {
    if (!existing) return;
    setBusy(true);
    const s = existing;
    const payload: Draft = {
      order_type: s.order_type, store: s.store, account: s.account,
      po2: s.po2, so_num: s.so_num, invoice_num: null,
      est_pallets: s.est_pallets, delivery_windows: s.delivery_windows,
      pickup_name: s.pickup_name, pickup_address: s.pickup_address, pickup_duration: s.pickup_duration,
      delivery_address: s.delivery_address, delivery_duration: s.delivery_duration,
      contact: s.contact, delivery_phone: s.delivery_phone, delivery_notes: s.delivery_notes,
      route_miles: s.route_miles, route_duration: s.route_duration,
      route_provider: s.route_provider, route_traffic: s.route_traffic,
      delivery_date: todayISO(), stage: "draft",
    };
    const row = await addDelivery(payload);
    setBusy(false);
    if (row) { notify(t(`Duplicated as #${row.order_no} (draft)`, `Duplicada como #${row.order_no} (borrador)`)); onClose(); }
  };

  // ---- Saved pickup / dropoff points ----
  // Pickup options = the stores (always valid pickup points) + any saved extras.
  const pickupOptions = useMemo(() => {
    const seen = new Set<string>();
    return [...settings.stores, ...(settings.pickup_locations ?? [])].filter((l) => {
      if (!l.name || seen.has(l.name)) return false;
      seen.add(l.name);
      return true;
    });
  }, [settings.stores, settings.pickup_locations]);

  const deliveryOptions = settings.delivery_locations ?? [];

  // Account options: saved accounts (with a contact + phone attached) plus
  // every distinct account name already used on a past order that hasn't
  // been saved with contact info yet — so the list is never missing one,
  // but only saved accounts auto-fill Contact / Delivery Phone Number.
  const savedAccounts = settings.accounts ?? [];
  const accountOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const a of savedAccounts) if (a.name.trim()) seen.add(a.name.trim());
    for (const x of deliveries) {
      const a = (x.account || "").trim();
      if (a) seen.add(a);
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliveries, settings.accounts]);

  const saveAccount = (rec: AccountRecord) => {
    const next = [...savedAccounts.filter((a) => a.name.toLowerCase() !== rec.name.toLowerCase()), rec];
    saveSettings({ accounts: next });
    notify(t(`Saved "${rec.name}" as an account`, `"${rec.name}" guardado como cuenta`));
  };

  const savePickupLocation = (loc: NamedLocation) => {
    saveSettings({ pickup_locations: [...(settings.pickup_locations ?? []), loc] });
    notify(t(`Saved "${loc.name}" as a pickup point`, `"${loc.name}" guardado como punto de recolección`));
  };

  const saveDeliveryLocation = (loc: NamedLocation) => {
    saveSettings({ delivery_locations: [...(settings.delivery_locations ?? []), loc] });
    notify(t(`Saved "${loc.name}" as a dropoff site`, `"${loc.name}" guardado como sitio de entrega`));
  };

  const info = stageInfo(stage);

  // ---- Unsaved-changes lock ----
  // The form must never vanish mid-typing. Any edit makes it "dirty", and the
  // backdrop / ✕ then ask before discarding.
  const dirty = editing && JSON.stringify(d) !== JSON.stringify(existing ?? EMPTY);
  const requestClose = async () => {
    if (dirty && !(await confirmAction(t(
      "You have unsaved changes to this order. Discard them?",
      "Tiene cambios sin guardar en esta orden. ¿Descartarlos?",
    ), { danger: true, confirmLabel: t("Discard", "Descartar") }))) return;
    onClose();
  };

  // Field editability: sales owns order data, warehouse owns fulfillment data.
  const salesFields = editing && (isNew || me.role === "sales" || me.role === "admin" || me.role === "manager");
  const whFields = editing && (me.role === "warehouse" || me.role === "admin");
  // Warehouse may edit only pallets + prepared status; temp & driver are admin-only.
  const adminFields = editing && me.role === "admin";
  // The Warehouse / Fulfillment section is only shown to warehouse & admin.
  const showWarehouse = me.role === "warehouse" || me.role === "admin";

  // ---------- DELIVERED SUCCESS SCREEN ----------
  // Shown right after the driver confirms delivery. The dialog stays open so
  // they can print the slip (with the signature) before closing.
  if (justDelivered) {
    return (
      <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal" style={{ maxWidth: 460, textAlign: "center" }}>
          <div style={{ fontSize: 44 }}>✅</div>
          <h3 style={{ marginTop: 8 }}>{t("Delivered", "Entregado")} #{justDelivered.order_no}</h3>
          <div className="sub" style={{ justifyContent: "center" }}>
            {t("Received by", "Recibido por")} <b>{justDelivered.pod_received_by}</b> · {fmtDateTime(justDelivered.pod_delivered_at)}
          </div>
          {justDelivered.pod_signature && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={justDelivered.pod_signature} alt="signature" style={{ maxHeight: 110, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, margin: "6px auto", display: "block" }} />
          )}
          <p className="hint" style={{ marginBottom: 16 }}>{t("Print the delivery slip, then close.", "Imprima el comprobante de entrega y luego cierre.")}</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={() => printDeliverySlip(justDelivered, settings, users, lang)}>🖨 {t("Print slip", "Imprimir comprobante")}</button>
            <button className="btn btn-ghost" onClick={onClose}>{t("Done", "Listo")}</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    // Backdrop clicks do nothing — the only way out is the explicit buttons
    // at the bottom of the form (or the header ✕, which still confirms if dirty).
    <div className="overlay">
      <div className="modal">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <h3>
              {isNew ? t("New delivery order", "Nueva orden de entrega") : `${t("Order", "Orden")} #${existing!.order_no}`}
              {dirty && <span className="sema" style={{ background: "var(--amber)", color: "#fff", marginLeft: 8 }}>● {t("Unsaved", "Sin guardar")}</span>}
            </h3>
            <div className="sub">
              {isNew ? t("Fill in the order details, then save as draft or submit for approval.", "Complete los datos de la orden, luego guárdela como borrador o envíela a aprobación.") : (
                <span className="sema" style={{ background: info.color, color: "#fff" }}>{stageLabel(stage, lang)}</span>
              )}
            </div>
          </div>
          <button className="btn btn-sm" onClick={requestClose}>✕</button>
        </div>

        {/* ---------- VIEW MODE ---------- */}
        {!editing && existing && (
          <>
            {me.role === "driver" ? (
              <DriverDeliveryScreen order={existing} settings={settings} notify={notify} t={t} />
            ) : (
              <div className="detail-grid">
                {deliveryColumns(existing).slice(1).map(([k, v]) => (
                  <div className="detail-row" key={k}>
                    <span className="dk">{colLabel(k, lang)}</span>
                    <span className="dv">{v || "—"}</span>
                  </div>
                ))}
              </div>
            )}
            {existing.rejected_reason && (
              <div className="card" style={{ marginTop: 14, background: "#fef6f6", borderColor: "var(--red)" }}>
                <b style={{ color: "var(--red)" }}>{t("Rejection reason:", "Motivo del rechazo:")}</b> {existing.rejected_reason}
              </div>
            )}
            {existing.redelivery_of && (
              <div className="card" style={{ marginTop: 14, background: "#fff7ec", borderColor: "var(--amber)" }}>
                <b style={{ color: "var(--amber)" }}>{t("🔁 Re-delivery", "🔁 Reentrega")}</b>
                {existing.redelivery_reason ? ` — ${existing.redelivery_reason}` : ""}
                <div className="hint" style={{ marginTop: 4 }}>{t("This order repeats an earlier delivery. Logged for the end-of-week review.", "Esta orden repite una entrega anterior. Registrada para la revisión de fin de semana.")}</div>
              </div>
            )}
            {settings.rc_calls_enabled && me.role !== "driver" && telClean(existing.delivery_phone).replace(/\D/g, "").length >= 7 && (
              <div style={{ marginTop: 14 }}>
                <div className="section-label" style={{ marginTop: 0 }}>{t("Call the customer", "Llamar al cliente")}</div>
                <CallClientButton phone={telClean(existing.delivery_phone)} notify={notify} t={t} />
                <div className="hint" style={{ marginTop: 6 }}>{t("Your RingCentral line rings first, then connects to", "Su línea RingCentral suena primero y luego conecta con")} {existing.contact || existing.account || t("the customer", "el cliente")} ({existing.delivery_phone}).</div>
              </div>
            )}
            <ShareTracking order={existing} notify={notify} t={t} />
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                const url = `${location.origin}/track/${existing.id}`;
                navigator.clipboard?.writeText(url).then(
                  () => notify(t("Tracking link copied", "Enlace de seguimiento copiado")),
                  () => window.prompt(t("Copy this tracking link:", "Copie este enlace de seguimiento:"), url),
                );
              }}>🔗 {t("Copy tracking link", "Copiar enlace")}</button>
            </div>
            {canDeliver(me) && me.role !== "driver" && existing.delivery_address && (
              <NavButtons
                origin={(existing.pickup_address || settings.stores.find((s) => s.name === existing.store)?.address || existing.store || "").trim()}
                destination={existing.delivery_address}
                t={t}
              />
            )}
            {/* ---------- Material photos (driver captures; sales reps don't see these) ---------- */}
            {me.role !== "sales" && (canDeliver(me) || (existing.photos?.length ?? 0) > 0) && (
              <>
                <div className="section-label">
                  📷 {t("Material photos", "Fotos del material")}
                  {(existing.photos?.length ?? 0) > 0 && <span className="count-tag" style={{ marginLeft: 8 }}>{existing.photos!.length}</span>}
                </div>
                <PhotoUpload
                  photos={existing.photos ?? []}
                  disabled={!canDeliver(me) || photoBusy}
                  onChange={async (next) => {
                    setPhotoBusy(true);
                    await updateDelivery(existing.id, { photos: next });
                    setPhotoBusy(false);
                    notify(t("Photos updated", "Fotos actualizadas"));
                  }}
                  t={t}
                />
                <div className="hint">{t("Photo of the load / material. On a phone this opens the camera.", "Foto de la carga / material. En el teléfono abre la cámara.")}</div>
              </>
            )}

            <div className="section-label">{t("Activity & notes", "Actividad y notas")}</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={t("Add a note for the team…", "Agregar una nota para el equipo…")}
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && noteText.trim() && !notingBusy) {
                    setNotingBusy(true); await addNote(existing.id, noteText); setNoteText(""); setNotingBusy(false);
                  }
                }}
              />
              <button className="btn btn-ghost" disabled={!noteText.trim() || notingBusy}
                onClick={async () => { setNotingBusy(true); await addNote(existing.id, noteText); setNoteText(""); setNotingBusy(false); }}>
                {t("Post", "Enviar")}
              </button>
            </div>
            <div className="detail-row"><span className="dk">{t("Created by", "Creado por")}</span><span className="dv">{userName(existing.created_by)} · {fmtDateTime(existing.created_at)}</span></div>
            {existing.assigned_sales_rep && (
              <div className="detail-row"><span className="dk">{t("Assigned to", "Asignado a")}</span><span className="dv">{userName(existing.assigned_sales_rep)}</span></div>
            )}
            {existing.approved_at && (
              <div className="detail-row"><span className="dk">{t("Approved by", "Aprobado por")}</span><span className="dv">{userName(existing.approved_by)} · {fmtDateTime(existing.approved_at)}</span></div>
            )}
            {events.map((e) => (
              <div className="log-row" key={e.id}>
                <span style={{ fontWeight: 700, minWidth: 90 }}>{eventLabel(e.kind, lang)}</span>
                <span style={{ color: "var(--gray)" }}>{userName(e.created_by)}</span>
                <span style={{ color: "var(--gray)" }}>{fmtDateTime(e.created_at)}</span>
                {e.note && <span>— {e.note}</span>}
              </div>
            ))}
          </>
        )}

        {/* ---------- EDIT MODE ---------- */}
        {editing && (
          <>
            <div className="section-label">{t("Order", "Orden")}</div>
            {needsSalesRep && (
              <div className="grid g2">
                <div className="field">
                  <label>{t("Sales Rep", "Vendedor")}{missingSet.has("assigned_sales_rep") && <span className="req-star"> *</span>}</label>
                  <select
                    className={missingSet.has("assigned_sales_rep") ? "invalid" : ""}
                    value={d.assigned_sales_rep ?? ""}
                    onChange={(e) => set("assigned_sales_rep", e.target.value || null)}
                  >
                    <option value="">{t("Select sales rep…", "Seleccione vendedor…")}</option>
                    {salesReps.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                </div>
              </div>
            )}
            <div className="grid g2">
              <Sel label={t("Order Type", "Tipo de Orden")} val={d.order_type} opts={settings.order_types} on={(v) => set("order_type", v)} disabled={!salesFields} placeholder={t("Select order type", "Seleccione tipo de orden")} invalid={missingSet.has("order_type")} />
              <Sel label={t("Store (Sold From)", "Tienda (Vendido Desde)")} val={d.store} opts={settings.stores.map((s) => s.name)} on={(v) => {
                // Choosing a saved store auto-fills the pickup name + address from it.
                const st = settings.stores.find((s) => s.name === v);
                setD((p) => ({
                  ...p,
                  store: v,
                  pickup_name: v || p.pickup_name,
                  pickup_address: st?.address ? st.address : p.pickup_address,
                }));
              }} disabled={!salesFields} placeholder={t("Select store", "Seleccione tienda")} invalid={missingSet.has("store")} />
            </div>
            <div className="grid g4">
              <Txt label="PO #2" val={d.po2} on={(v) => set("po2", v)} disabled={!salesFields} invalid={missingSet.has("po2")} />
              <Txt label="SO #" val={d.so_num} on={(v) => set("so_num", v)} disabled={!salesFields} invalid={missingSet.has("so_num")} />
              <Txt label={t("Customer Invoice #", "Factura del Cliente #")} val={d.invoice_num} on={(v) => set("invoice_num", v)} disabled={!salesFields} invalid={missingSet.has("invoice_num") || !!invoiceDup} />
              <Txt label={t("Est. Pallets (sales)", "Tarimas Est. (ventas)")} type="number" val={d.est_pallets ?? ""} on={(v) => set("est_pallets", v === "" ? null : Number(v))} disabled={!salesFields} invalid={missingSet.has("est_pallets")} />
            </div>
            {invoiceDup && (
              <div className="hint" style={{ color: "var(--red)", fontWeight: 600, marginTop: -6, marginBottom: 10 }}>
                ⚠ {t(
                  `Duplicate invoice — order #${invoiceDup.order_no} already uses invoice #${invoiceDup.invoice_num}.`,
                  `Factura duplicada — la orden #${invoiceDup.order_no} ya usa la factura #${invoiceDup.invoice_num}.`,
                )}
              </div>
            )}
            <div className="grid g2">
              <Txt label={t("Delivery Fee charged ($)", "Costo de Entrega cobrado ($)")} type="number" val={d.delivery_fee ?? ""} on={(v) => set("delivery_fee", v === "" ? null : Number(v))} disabled={!salesFields} placeholder="0.00" />
            </div>

            <div className="section-label">{t("Schedule", "Programación")}</div>
            <div className="grid g2">
              <Txt label={t("Delivery Date", "Fecha de Entrega")} type="date" val={d.delivery_date} on={(v) => set("delivery_date", v)} disabled={!salesFields} invalid={missingSet.has("delivery_date")} />
              <WindowSel val={d.delivery_windows} on={(v) => set("delivery_windows", v)} disabled={!salesFields} invalid={missingSet.has("delivery_windows")} t={t} />
            </div>
            {scheduleWarnings.length > 0 && (
              <div className="card" style={{ marginTop: 10, background: "#fff7ec", borderColor: "var(--amber)" }}>
                <b style={{ color: "#b9791a" }}>⚠ {t("Scheduling conflict", "Conflicto de programación")}</b>
                <ul style={{ margin: "6px 0 0 18px", fontSize: 12.5, lineHeight: 1.5 }}>
                  {scheduleWarnings.map((w) => <li key={w.code}>{t(w.en, w.es)}</li>)}
                </ul>
                <div className="hint" style={{ marginTop: 4 }}>{t("You can still submit — you'll be asked to confirm.", "Aún puede enviarla — se le pedirá confirmar.")}</div>
              </div>
            )}

            <div className="section-label">{t("Pickup", "Recolección")}</div>
            <div className="grid g2">
              <LocationCombo
                nameLabel={t("Pickup Name", "Nombre de Recolección")}
                addressLabel={t("Pickup Address", "Dirección de Recolección")}
                name={d.pickup_name}
                address={d.pickup_address}
                options={pickupOptions}
                onName={(v) => set("pickup_name", v)}
                onAddress={(v) => set("pickup_address", v)}
                onSave={savePickupLocation}
                disabled={!salesFields}
                nameInvalid={missingSet.has("pickup_name")}
                addressInvalid={missingSet.has("pickup_address")}
                namePlaceholder={t("Select a pickup point…", "Seleccione un punto de recolección…")}
                addressPlaceholder={t("Search an address…", "Busca una dirección…")}
                t={t}
              />
            </div>

            <div className="section-label">{t("Delivery", "Entrega")}</div>
            {isIntraStore ? (
              // Intra-store transfer: the destination is another known store, picked
              // from the dropdown — but the dropoff address is always shown too.
              <div className="grid g2">
                <Sel
                  label={t("Delivery Store (destination)", "Tienda de Entrega (destino)")}
                  val={deliveryStore}
                  opts={settings.stores.map((s) => s.name)}
                  on={(v) => {
                    const st = settings.stores.find((s) => s.name === v);
                    // The destination store IS the dropoff name for a transfer.
                    setD((p) => ({ ...p, delivery_name: v, delivery_address: st?.address ?? "", contact: v || p.contact }));
                  }}
                  disabled={!salesFields}
                  placeholder={t("Select destination store", "Seleccione tienda destino")}
                  invalid={missingSet.has("delivery_name") || missingSet.has("delivery_address")}
                />
                <Txt label={t("Delivery Address (dropoff)", "Dirección de Entrega (destino)")} val={d.delivery_address} on={(v) => set("delivery_address", v)} disabled={!salesFields} placeholder={t("filled from the destination store", "se completa desde la tienda destino")} />
              </div>
            ) : (
              <div className="grid g2">
                <LocationCombo
                  nameLabel={t("Dropoff Name", "Nombre de Destino")}
                  addressLabel={t("Delivery Address (dropoff)", "Dirección de Entrega (destino)")}
                  name={d.delivery_name}
                  address={d.delivery_address}
                  options={deliveryOptions}
                  onName={(v) => set("delivery_name", v)}
                  onAddress={(v) => set("delivery_address", v)}
                  onSave={saveDeliveryLocation}
                  disabled={!salesFields}
                  nameInvalid={missingSet.has("delivery_name")}
                  addressInvalid={missingSet.has("delivery_address")}
                  namePlaceholder={t("Select a saved site…", "Seleccione un sitio guardado…")}
                  addressPlaceholder={t("Start typing an address…", "Empiece a escribir una dirección…")}
                  t={t}
                />
              </div>
            )}

            {/* ---------- Exact pin (for sites with no real address yet, e.g. a construction site) ---------- */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: showPinPicker ? 8 : 0 }}>
              <button className="btn btn-ghost btn-sm" disabled={!salesFields} onClick={() => {
                setPinDraft(d.delivery_lat != null && d.delivery_lng != null ? [d.delivery_lat, d.delivery_lng] : null);
                setShowPinPicker((s) => !s);
              }}>
                📍 {t("Set exact location on map", "Marcar ubicación exacta en el mapa")}
              </button>
              {pinLookupBusy ? (
                <span className="hint">{t("Looking up the address…", "Buscando la dirección…")}</span>
              ) : d.delivery_lat != null && d.delivery_lng != null && (
                <span className="hint">
                  {d.delivery_pin_source === "manual"
                    ? t("Exact pin set — the driver will navigate straight to it.", "Pin exacto marcado — el chofer navegará directo a él.")
                    : t("Location found from the address above.", "Ubicación encontrada a partir de la dirección de arriba.")}
                </span>
              )}
            </div>
            {showPinPicker && (
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="hint" style={{ marginBottom: 8 }}>
                  {t("Move the mouse to preview the spot, then right-click to drop the pin — useful when there's no formal address yet (a construction site, a lot).", "Mueva el mouse para previsualizar el punto y haga clic derecho para marcarlo — útil cuando aún no hay una dirección formal (un sitio de construcción, un lote).")}
                </div>
                <LeafletMap
                  pickable
                  pickedPoint={pinDraft}
                  center={pinDraft ?? (d.delivery_lat != null && d.delivery_lng != null ? [d.delivery_lat, d.delivery_lng] : undefined)}
                  onPick={(lat, lng) => setPinDraft([lat, lng])}
                  height={280}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button className="btn btn-primary btn-sm" disabled={!pinDraft} onClick={() => {
                    if (!pinDraft) return;
                    savePin(pinDraft[0], pinDraft[1]);
                  }}>{t("Save pin", "Guardar pin")}</button>
                  {(d.delivery_lat != null || pinDraft) && (
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      set("delivery_lat", null); set("delivery_lng", null); set("delivery_pin_source", null);
                      setPinDraft(null); setShowPinPicker(false);
                    }}>{t("Clear pin", "Quitar pin")}</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowPinPicker(false)}>{t("Cancel", "Cancelar")}</button>
                </div>
              </div>
            )}

            <div className="grid g3">
              <AccountCombo
                val={d.account}
                on={(v) => {
                  // Picking a saved account also fills who to contact there —
                  // still editable after, for a one-off override.
                  const rec = savedAccounts.find((a) => a.name.toLowerCase() === v.toLowerCase());
                  setD((p) => ({ ...p, account: v, contact: rec ? rec.contact : p.contact, delivery_phone: rec ? rec.phone : p.delivery_phone }));
                }}
                options={accountOptions}
                disabled={!salesFields || intraTienda}
                placeholder={t("Select account…", "Seleccione cuenta…")}
                t={t}
              />
              <Txt label={t("Contact name", "Nombre de Contacto")} val={d.contact} on={(v) => set("contact", v)} disabled={!salesFields || intraTienda} invalid={missingSet.has("contact")} />
              <Txt label={t("Delivery Phone Number", "Teléfono de Entrega")} val={d.delivery_phone} on={(v) => set("delivery_phone", v)} disabled={!salesFields || intraTienda} invalid={missingSet.has("delivery_phone")} />
            </div>
            {salesFields && !intraTienda && !!d.account?.trim() && !!d.contact?.trim() && !!d.delivery_phone?.trim() &&
              !savedAccounts.some((a) => a.name.toLowerCase() === d.account!.trim().toLowerCase() && a.contact === d.contact && a.phone === d.delivery_phone) && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: -6, marginBottom: 10 }}
                  onClick={() => saveAccount({ name: d.account!.trim(), contact: d.contact!.trim(), phone: d.delivery_phone!.trim() })}
                >
                  💾 {t("Save this contact for the account", "Guardar este contacto para la cuenta")}
                </button>
            )}
            <div className="field">
              <label>{t("Delivery Notes", "Notas de Entrega")}</label>
              <textarea rows={2} value={d.delivery_notes ?? ""} disabled={!salesFields} onChange={(e) => set("delivery_notes", e.target.value)} />
            </div>

            <div className="section-label">{t("Route", "Ruta")}</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn btn-ghost" onClick={calcRoute} disabled={routing}>
                {routing ? t("Calculating…", "Calculando…") : t("🚚 Auto-calculate distance & ETA", "🚚 Calcular distancia y tiempo")}
              </button>
              <div style={{ width: 110 }}>
                <Txt
                  label={t("Miles (editable)", "Millas (editable)")}
                  type="number"
                  val={d.route_miles ?? ""}
                  on={(v) => set("route_miles", v === "" ? null : Number(v))}
                  disabled={!salesFields}
                  placeholder="0"
                />
              </div>
              {d.route_duration && (
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <span><b style={{ fontFamily: "Archivo", fontSize: 18 }}>{d.route_duration}</b> {t("drive", "manejo")}</span>
                  <span className="sema" style={{ background: d.route_traffic ? "var(--green)" : "var(--gray)", color: "#fff" }}>
                    {d.route_traffic ? t("live traffic", "tráfico en vivo") : t("typical", "típico")} · {d.route_provider}
                  </span>
                </div>
              )}
            </div>
            <div className="hint">{t("Auto-calculate fills this in from a live routing service; you can also type the miles directly.", "El cálculo automático llena esto con un servicio de ruteo en vivo; también puede escribir las millas directamente.")}</div>
            {routeErr && <div className="hint" style={{ color: "var(--red)" }}>{routeErr}</div>}
            {!routing && !routeErr && (d.delivery_address || "").trim() && d.route_miles == null && (
              <div className="hint" style={{ color: "var(--amber)" }}>⚠ {t("Delivery address not verified yet — recalculate to confirm it maps to a real location.", "Dirección de entrega no verificada — recalcule para confirmar que corresponde a una ubicación real.")}</div>
            )}

            {showWarehouse && (
              <>
                <div className="section-label">{t("Warehouse / Fulfillment", "Almacén / Preparación")}</div>
                <div className="grid g4">
                  <Txt label={t("Actual Pallets (warehouse)", "Tarimas Reales (almacén)")} type="number" val={d.actual_pallets ?? ""} on={(v) => set("actual_pallets", v === "" ? null : Number(v))} disabled={!whFields} placeholder={d.est_pallets != null ? t(`est. ${d.est_pallets}`, `est. ${d.est_pallets}`) : ""} />
                  <Txt label={t("Prepared Status", "Estado de Preparación")} val={d.prepared_status} on={(v) => set("prepared_status", v)} disabled={!whFields} placeholder={t("e.g. Staged", "ej. Preparado")} />
                  <Txt label={t("Status (Temp)", "Estado (Temp)")} val={d.status_temp} on={(v) => set("status_temp", v)} disabled={!adminFields} placeholder={t("e.g. Ambient", "ej. Ambiente")} />
                  <Sel label={t("Assigned Driver", "Chofer Asignado")} val={d.assigned_driver} opts={driverNames(users)} on={(v) => set("assigned_driver", v)} disabled={!adminFields} placeholder={t("Unassigned", "Sin asignar")} />
                </div>
                {adminFields && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <button className="btn btn-ghost btn-sm" onClick={suggestAndSet}>✨ {t("Suggest least-busy driver", "Sugerir chofer menos ocupado")}</button>
                  </div>
                )}
                {conflicts.length > 0 && (
                  <div className="card" style={{ marginTop: 10, background: "#fff7ec", borderColor: "var(--amber)" }}>
                    <b style={{ color: "#b9791a" }}>⚠ {t("Schedule conflict", "Conflicto de horario")}</b>
                    <div className="hint" style={{ marginTop: 2 }}>
                      {t(
                        `${d.assigned_driver} already has an overlapping window this day:`,
                        `${d.assigned_driver} ya tiene una ventana que se traslapa ese día:`,
                      )}{" "}
                      {conflicts.map((c) => `#${c.order_no} (${c.delivery_windows || "—"})`).join(", ")}
                    </div>
                  </div>
                )}
              </>
            )}
            {!whFields && !salesFields && (
              <div className="hint">{t("You have view-only access to this order at its current stage.", "Tiene acceso de solo lectura a esta orden en su etapa actual.")}</div>
            )}
          </>
        )}

        {/* ---------- REJECT REASON ---------- */}
        {showReject && (
          <div className="field" style={{ marginTop: 14 }}>
            <label>{t("Rejection reason (sent back to sales)", "Motivo del rechazo (se envía a ventas)")}</label>
            <textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={t("What needs to change?", "¿Qué se necesita cambiar?")} />
          </div>
        )}

        {/* ---------- PROOF OF DELIVERY ---------- */}
        {showPod && (
          <div className="field" style={{ marginTop: 14 }}>
            <div className="section-label" style={{ marginTop: 0 }}>{t("Proof of delivery", "Comprobante de entrega")}</div>
            <label>{t("Received by", "Recibido por")}</label>
            <input value={podName} onChange={(e) => setPodName(e.target.value)} placeholder={t("Name of person who received it", "Nombre de quien recibió")} />
            <label style={{ marginTop: 10 }}>{t("Signature", "Firma")}</label>
            <SignaturePad onChange={setPodSig} />
            <div className="hint" style={{ marginTop: 6 }}>
              {geoAvailable()
                ? t("📍 Your location will be recorded with this delivery.", "📍 Su ubicación se registrará con esta entrega.")
                : t("📍 Location can't be recorded here (needs a secure https connection).", "📍 No se puede registrar la ubicación aquí (requiere conexión https segura).")}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => { setShowPod(false); setPodName(""); setPodSig(null); }} disabled={busy}>{t("Back", "Atrás")}</button>
              <button className="btn btn-green btn-sm" disabled={busy || !podName.trim()} onClick={deliverWithPod}>{t("Confirm delivered", "Confirmar entregado")}</button>
            </div>
          </div>
        )}

        {/* ---------- POD (view, after delivery) ---------- */}
        {!editing && existing?.pod_received_by && (
          <div className="card" style={{ marginTop: 14 }}>
            <b>✅ {t("Delivered to", "Entregado a")}:</b> {existing.pod_received_by}
            {existing.pod_delivered_at && <span className="hint"> · {fmtDateTime(existing.pod_delivered_at)}</span>}
            {existing.pod_lat != null && existing.pod_lng != null && (
              <div style={{ marginTop: 6, fontSize: 12.5 }}>
                📍 <a className="link-tel" href={mapLink(existing.pod_lat, existing.pod_lng)} target="_blank" rel="noopener noreferrer">
                  {t("Delivered at this location", "Entregado en esta ubicación")}
                </a>
                {existing.pod_accuracy != null && <span className="hint"> (±{existing.pod_accuracy} m)</span>}
              </div>
            )}
            {existing.pod_signature && (
              // eslint-disable-next-line @next/next/no-img-element
              <div style={{ marginTop: 8 }}><img src={existing.pod_signature} alt="signature" style={{ maxHeight: 90, background: "#fff", border: "1px solid var(--line)", borderRadius: 8 }} /></div>
            )}
          </div>
        )}

        {/* ---------- CANCEL REASON ---------- */}
        {showCancel && (
          <div className="field" style={{ marginTop: 14 }}>
            <label>{t("Cancellation reason (recorded for reporting)", "Motivo de cancelación (registrado para reportes)")}</label>
            <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}>
              <option value="">{t("Select a reason…", "Seleccione un motivo…")}</option>
              {CANCEL_REASONS.map((r) => <option key={r.en} value={t(r.en, r.es)}>{t(r.en, r.es)}</option>)}
            </select>
          </div>
        )}

        {/* ---------- RE-DELIVERY: record a repeat ---------- */}
        {!editing && existing && existing.stage === "delivered" && (canFulfill(me) || canApprove(me)) && (
          showRedeliver ? (
            <div className="field" style={{ marginTop: 14 }}>
              <label>{t("Why does this order need to be delivered again?", "¿Por qué debe entregarse esta orden de nuevo?")}</label>
              <textarea rows={2} value={redeliverReason} onChange={(e) => setRedeliverReason(e.target.value)} placeholder={t("e.g. wrong pallet loaded, damaged in transit…", "ej. tarima equivocada, dañado en tránsito…")} />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => { setShowRedeliver(false); setRedeliverReason(""); }} disabled={busy}>{t("Cancel", "Cancelar")}</button>
                <button className="btn btn-amber btn-sm" disabled={busy || !redeliverReason.trim()} onClick={recordRedelivery}>{t("Create re-delivery", "Crear reentrega")}</button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-amber btn-sm" onClick={() => setShowRedeliver(true)}>🔁 {t("Record re-delivery", "Registrar reentrega")}</button>
              <div className="hint">{t("Log a repeat of this delivery (warehouse error, damage…) as a new linked order.", "Registra una repetición de esta entrega (error de almacén, daño…) como una nueva orden vinculada.")}</div>
            </div>
          )
        )}

        {/* ---------- STILL MISSING (moved to the bottom, right above the buttons) ---------- */}
        {editing && missing.length > 0 && (
          <div className="card" style={{ marginTop: 14, marginBottom: 0, background: "#fdeaea", borderColor: "var(--red)" }}>
            <b style={{ color: "var(--red)" }}>{t("Still missing", "Faltan")} ({missing.length})</b>
            <ul style={{ margin: "6px 0 0 18px", fontSize: 12.5, lineHeight: 1.5 }}>
              {missing.map((m) => <li key={m.key}>{t(m.en, m.es)}</li>)}
            </ul>
            <div className="hint" style={{ marginTop: 4 }}>{t("Marked in red above. You can still submit — you'll be asked to confirm.", "Marcados en rojo arriba. Aún puede enviar — se le pedirá confirmar.")}</div>
          </div>
        )}

        {/* ---------- ACTIONS ---------- */}
        <div className="modal-actions">
          {existing && me.role === "admin" && (
            <button className="btn btn-danger" onClick={remove} disabled={busy}>{t("Delete", "Eliminar")}</button>
          )}
          {existing && !editing && canCreate(me) && (
            <button className="btn btn-ghost" onClick={duplicate} disabled={busy} title={t("Create a new draft order from this one", "Crear una nueva orden borrador a partir de esta")}>⧉ {t("Duplicate", "Duplicar")}</button>
          )}
          <span style={{ flex: 1 }} />

          {editing ? (
            <>
              {!isNew && canEditFields(me.role, stage) && (
                <button className="btn btn-ghost" onClick={() => { setEditing(false); setD(existing!); }} disabled={busy}>{t("Cancel edit", "Cancelar edición")}</button>
              )}
              {isNew ? (
                <>
                  <button className="btn btn-danger" onClick={async () => { if (await confirmAction(t("Discard this order? Nothing will be saved.", "¿Descartar esta orden? No se guardará nada."), { danger: true, confirmLabel: t("Discard", "Descartar") })) onClose(); }} disabled={busy}>{t("Discard", "Descartar")}</button>
                  {canCreate(me) && <button className="btn btn-ghost" onClick={save} disabled={busy}>{t("Save draft", "Guardar borrador")}</button>}
                  {canCreate(me) && (
                    <button className="btn btn-primary" disabled={busy} onClick={async () => {
                      // Office Managers approve their own orders on the spot —
                      // no need to route it back to themselves (or a peer) for approval.
                      const autoApprove = me.role === "manager";
                      const payload = withDurations({
                        ...d,
                        stage: autoApprove ? "approved" : "pending",
                        ...(autoApprove ? { approved_by: me.id, approved_at: new Date().toISOString() } : {}),
                      });
                      if (!(await passesChecks(payload))) return;
                      setBusy(true);
                      const row = await addDelivery(payload);
                      setBusy(false);
                      if (row) {
                        notify(autoApprove
                          ? t(`Order #${row.order_no} created and approved`, `Orden #${row.order_no} creada y aprobada`)
                          : t(`Order #${row.order_no} submitted for approval`, `Orden #${row.order_no} enviada a aprobación`));
                        await autoSendTracking(row); onClose();
                      }
                    }}>{me.role === "manager" ? t("Create order (approved)", "Crear orden (aprobada)") : t("Submit for approval", "Enviar a aprobación")}</button>
                  )}
                </>
              ) : (
                <button className="btn btn-primary" onClick={save} disabled={busy}>{t("Save changes", "Guardar cambios")}</button>
              )}
            </>
          ) : existing ? (
            <StageActions me={me} stage={stage} busy={busy}
              onEdit={() => setEditing(true)}
              onMove={move}
              showReject={showReject}
              setShowReject={setShowReject}
              rejectReason={rejectReason}
              showCancel={showCancel}
              setShowCancel={setShowCancel}
              cancelReason={cancelReason}
              onPrint={() => printDeliverySlip(existing!, settings, users, lang)}
              onRequestDeliver={() => setShowPod(true)}
              podOpen={showPod}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** The workflow buttons shown in view mode, gated by role + current stage. */
function StageActions({
  me, stage, busy, onEdit, onMove, showReject, setShowReject, rejectReason,
  showCancel, setShowCancel, cancelReason, onPrint, onRequestDeliver, podOpen,
}: {
  me: Profile; stage: Stage; busy: boolean;
  onEdit: () => void;
  onMove: (to: Stage, note?: string) => void;
  showReject: boolean; setShowReject: (v: boolean) => void; rejectReason: string;
  showCancel: boolean; setShowCancel: (v: boolean) => void; cancelReason: string;
  onPrint: () => void; onRequestDeliver: () => void; podOpen: boolean;
}) {
  const { t } = usePrefs();
  const btns: React.ReactNode[] = [];

  // Printable delivery slip / packing list — available on any real order.
  btns.push(<button key="print" className="btn btn-ghost" onClick={onPrint} disabled={busy}>🖨 {t("Slip", "Comprobante")}</button>);

  if (canEditFields(me.role, stage)) {
    btns.push(<button key="edit" className="btn btn-ghost" onClick={onEdit} disabled={busy}>{t("Edit", "Editar")}</button>);
  }

  // Anyone who can create orders also shepherds their own drafts through submit/resubmit/cancel.
  if (canCreate(me)) {
    if (stage === "draft") btns.push(<button key="submit" className="btn btn-primary" onClick={() => onMove("pending")} disabled={busy}>{t("Submit for approval", "Enviar a aprobación")}</button>);
    if (stage === "rejected") btns.push(<button key="resub" className="btn btn-primary" onClick={() => onMove("pending")} disabled={busy}>{t("Resubmit", "Reenviar")}</button>);
    if (stage === "draft" || stage === "rejected") {
      if (!showCancel) {
        btns.push(<button key="cancel" className="btn btn-danger" onClick={() => setShowCancel(true)} disabled={busy}>{t("Cancel order", "Cancelar orden")}</button>);
      } else {
        btns.push(<button key="cancelback" className="btn btn-ghost" onClick={() => setShowCancel(false)} disabled={busy}>{t("Back", "Atrás")}</button>);
        btns.push(<button key="docancel" className="btn btn-danger" disabled={busy || !cancelReason} onClick={() => onMove("canceled", cancelReason)}>{t("Confirm cancel", "Confirmar cancelación")}</button>);
      }
    }
  }

  // Manager
  if (canApprove(me) && stage === "pending") {
    if (!showReject) {
      btns.push(<button key="reject" className="btn btn-danger" onClick={() => setShowReject(true)} disabled={busy}>{t("Reject…", "Rechazar…")}</button>);
      btns.push(<button key="approve" className="btn btn-green" onClick={() => onMove("approved")} disabled={busy}>{t("Approve", "Aprobar")}</button>);
    } else {
      btns.push(<button key="cancelrej" className="btn btn-ghost" onClick={() => setShowReject(false)} disabled={busy}>{t("Back", "Atrás")}</button>);
      btns.push(<button key="dorej" className="btn btn-danger" disabled={busy || !rejectReason.trim()} onClick={() => onMove("rejected", rejectReason.trim())}>{t("Confirm reject", "Confirmar rechazo")}</button>);
    }
  }
  if (canApprove(me) && stage === "approved") {
    btns.push(<button key="unlock" className="btn btn-amber" onClick={() => onMove("pending")} disabled={busy}>{t("Unlock (back to pending)", "Desbloquear (volver a pendiente)")}</button>);
  }

  // Warehouse
  if (canFulfill(me)) {
    if (stage === "approved") btns.push(<button key="start" className="btn btn-primary" onClick={() => onMove("fulfilling")} disabled={busy}>{t("Start fulfilling", "Comenzar preparación")}</button>);
    if (stage === "fulfilling") btns.push(<button key="ready" className="btn btn-green" onClick={() => onMove("ready")} disabled={busy}>{t("Mark ready", "Marcar listo")}</button>);
  }

  // Driver (and warehouse/admin): pick up a ready order, then mark it delivered.
  if (canDeliver(me) && stage === "ready") {
    btns.push(<button key="pickup" className="btn btn-primary" onClick={() => onMove("picked_up")} disabled={busy}>🚚 {t("Pick up — out for delivery", "Recoger — en reparto")}</button>);
  }
  if (canDeliver(me) && stage === "picked_up" && !podOpen) {
    btns.push(<button key="deliv" className="btn btn-green" onClick={onRequestDeliver} disabled={busy}>{t("Mark delivered", "Marcar entregado")}</button>);
  }

  return <>{btns}</>;
}

// Click-to-call the customer via RingCentral RingOut: rings the agent's line
// first, then connects to the client. Works from a desktop (no dialer app).
function CallClientButton({
  phone, notify, t, className = "btn btn-green btn-sm",
}: {
  phone: string;
  notify: (m: string) => void;
  t: (en: string, es: string) => string;
  className?: string;
}) {
  const [calling, setCalling] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [callId, setCallId] = useState<string>("");
  const [ended, setEnded] = useState(false);

  // Human-readable, bilingual label for a RingCentral call status.
  const label = (s: string) => {
    const map: Record<string, [string, string]> = {
      InProgress: ["Ringing…", "Sonando…"],
      Success: ["Connected", "Conectado"],
      Busy: ["Line busy", "Línea ocupada"],
      NoAnswer: ["No answer", "Sin respuesta"],
      Rejected: ["Rejected", "Rechazada"],
      Error: ["Call error", "Error de llamada"],
      Finished: ["Call ended", "Llamada finalizada"],
      Voicemail: ["Voicemail", "Buzón de voz"],
    };
    const m = map[s]; return m ? t(m[0], m[1]) : s;
  };

  const poll = async (id: string) => {
    // Poll up to ~40s; stop once the call reaches a terminal state.
    const terminal = ["Success", "Busy", "NoAnswer", "Rejected", "Error", "Finished", "Voicemail"];
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(`/api/call?id=${encodeURIComponent(id)}`);
        const b = await res.json().catch(() => ({}));
        if (b.callStatus) { setStatus(b.callStatus); if (terminal.includes(b.callStatus)) break; }
      } catch { /* keep polling */ }
    }
  };

  const call = async () => {
    setCalling(true);
    setStatus("");
    setEnded(false);
    setCallId("");
    try {
      const res = await fetch("/api/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone }),
      });
      const b = await res.json().catch(() => ({}));
      if (b.ok) {
        notify(t("Calling… your RingCentral line will ring, then connect to the client.", "Llamando… su línea RingCentral sonará y luego conectará con el cliente."));
        setStatus(b.status || "InProgress");
        if (b.id) { setCallId(b.id); await poll(b.id); }
      } else if (b.dryRun) notify(t("RingCentral calling isn’t configured.", "La llamada por RingCentral no está configurada."));
      else notify(b.error || t("Could not place the call", "No se pudo realizar la llamada"));
    } catch {
      notify(t("Network error placing the call", "Error de red al llamar"));
    } finally {
      setCalling(false);
      setEnded(true);
    }
  };

  const hangUp = async () => {
    if (!callId) return;
    try {
      await fetch(`/api/call?id=${encodeURIComponent(callId)}`, { method: "DELETE" });
      notify(t("Call ended", "Llamada finalizada"));
      setStatus("Finished");
    } catch {
      notify(t("Could not hang up", "No se pudo colgar"));
    }
  };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {!calling && !ended && (
        <button className={className} onClick={call}>☎ {t("Call via RingCentral", "Llamar por RingCentral")}</button>
      )}
      {calling && (
        <>
          <button className={className} disabled>☎ {t("Calling…", "Llamando…")}</button>
          {callId && <button className="btn btn-danger btn-sm" onClick={hangUp}>🔴 {t("Hang up", "Colgar")}</button>}
        </>
      )}
      {ended && !calling && (
        <button className={className} onClick={call}>🔁 {t("Redial", "Rellamar")}</button>
      )}
      {status && <span className="sema" style={{ background: "var(--ink)", color: "#fff" }}>{label(status)}</span>}
    </span>
  );
}

// Driver-optimized delivery screen: large, glanceable delivery info + client
// contact with one-tap Call / Text / Navigate. "Call client" opens the phone's
// native dialer via a tel: link so the driver rings the customer instantly.
function DriverDeliveryScreen({
  order, settings, notify, t,
}: {
  order: Delivery;
  settings: Settings;
  notify: (m: string) => void;
  t: (en: string, es: string) => string;
}) {
  const phone = telClean(order.delivery_phone);
  const hasPhone = phone.replace(/\D/g, "").length >= 7;
  const dest = (order.delivery_address || "").trim();
  const origin = (order.pickup_address || settings.stores.find((s) => s.name === order.store)?.address || order.store || "").trim();
  // An exact pin (manual or auto-geocoded) is more precise than the address
  // text — used for navigation whenever it's available.
  const hasPin = order.delivery_lat != null && order.delivery_lng != null;
  const destParam = hasPin ? `${order.delivery_lat},${order.delivery_lng}` : dest;
  const gmaps = "https://www.google.com/maps/dir/?api=1" + (origin ? `&origin=${encodeURIComponent(origin)}` : "") + `&destination=${encodeURIComponent(destParam)}&travelmode=driving`;
  const waze = hasPin
    ? `https://www.waze.com/ul?ll=${order.delivery_lat},${order.delivery_lng}&navigate=yes`
    : `https://www.waze.com/ul?q=${encodeURIComponent(dest)}&navigate=yes`;

  // Where the driver collects the load — the pickup point's own name if it has
  // one, otherwise the store it's sold from.
  const pickupPlace = order.pickup_name || order.store;

  return (
    <div className="drv-screen">
      {/* Step 1: collect. Stated up front so the driver knows where to start. */}
      <div className="drv-banner">
        <span className="drv-banner-step">1</span>
        <div>
          <div className="drv-banner-title">
            📦 {pickupPlace
              ? t(`Pick up in ${pickupPlace}`, `Recoger en ${pickupPlace}`)
              : t("Pick up", "Recoger")}
          </div>
          {origin && <div className="drv-banner-sub">{origin}</div>}
        </div>
        {origin && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(origin)}`, "_blank", "noopener")}
          >
            🧭
          </button>
        )}
      </div>

      {/* Step 2: deliver. */}
      <div className="drv-banner drv-banner-drop">
        <span className="drv-banner-step">2</span>
        <div>
          <div className="drv-banner-title">
            🚚 {order.account || order.delivery_name
              ? t(`Deliver to ${order.account || order.delivery_name}`, `Entregar a ${order.account || order.delivery_name}`)
              : t("Deliver", "Entregar")}
          </div>
          <div className="drv-banner-sub">
            {[order.delivery_name && order.delivery_name !== order.account ? order.delivery_name : null, dest]
              .filter(Boolean).join(" · ") || "—"}
          </div>
          {order.delivery_pin_source === "manual" && (
            <div className="drv-banner-sub" style={{ color: "var(--accent)", fontWeight: 700 }}>
              📍 {t("No formal address — an exact pin was dropped for this site. Navigate uses the pin.", "Sin dirección formal — se marcó un pin exacto para este sitio. Navegar usa el pin.")}
            </div>
          )}
        </div>
      </div>

      <div className="drv-row2">
        <div className="drv-block">
          <div className="drv-k">📅 {t("Date", "Fecha")}</div>
          <div className="drv-v">{order.delivery_date ? fmtDate(order.delivery_date) : "—"}</div>
        </div>
        <div className="drv-block">
          <div className="drv-k">⏰ {t("Time window", "Ventana")}</div>
          <div className="drv-v">{order.delivery_windows || "—"}</div>
        </div>
        <div className="drv-block">
          <div className="drv-k">📦 {t("Pallets", "Tarimas")}</div>
          <div className="drv-v">{order.actual_pallets ?? order.est_pallets ?? "—"}</div>
        </div>
      </div>

      <div className="drv-block">
        <div className="drv-k">👤 {t("Client contact", "Contacto del cliente")}</div>
        <div className="drv-v">{order.contact || "—"}{hasPhone && <span className="drv-phone"> · {order.delivery_phone}</span>}</div>
      </div>

      {order.delivery_notes && (
        <div className="drv-block drv-notes">
          <div className="drv-k">📝 {t("Notes", "Notas")}</div>
          <div>{order.delivery_notes}</div>
        </div>
      )}

      {order.pickup_lat != null && order.pickup_lng != null && (
        <div className="drv-block">
          <div className="drv-k">📍 {t("Picked up at", "Recogido en")}</div>
          <a className="link-tel" href={mapLink(order.pickup_lat, order.pickup_lng)} target="_blank" rel="noopener noreferrer">
            {t("View pickup location", "Ver ubicación de recolección")}
          </a>
          {order.pickup_gps_at && <span className="hint"> · {fmtDateTime(order.pickup_gps_at)}</span>}
        </div>
      )}

      <div className="drv-actions">
        {hasPhone ? (
          <>
            <a className="btn btn-green drv-call" href={`tel:${phone}`}>📞 {t("Call client", "Llamar cliente")}</a>
            {settings.rc_calls_enabled && (
              <CallClientButton phone={phone} notify={notify} t={t} className="btn btn-primary drv-call" />
            )}
            <a className="btn btn-ghost drv-call" href={`sms:${phone}`}>💬 {t("Text", "Mensaje")}</a>
          </>
        ) : (
          <span className="hint">{t("No client phone on file.", "Sin teléfono del cliente.")}</span>
        )}
        {dest && (
          <>
            <button className="btn btn-primary drv-call" onClick={() => window.open(gmaps, "_blank", "noopener")}>🧭 {t("Navigate", "Navegar")}</button>
            <button className="btn btn-ghost drv-call" onClick={() => window.open(waze, "_blank", "noopener")}>Waze</button>
          </>
        )}
      </div>
    </div>
  );
}

// Share the live tracking link with the customer. Three ways:
//  • Text  — opens the phone's SMS app to the customer's number, pre-filled.
//  • WhatsApp — opens WhatsApp with the message ready to send.
//  • Auto SMS — sends server-side via /api/notify (Twilio). No-op with a clear
//    hint until TWILIO_* env vars are set.
function ShareTracking({
  order, notify, t,
}: {
  order: Delivery;
  notify: (m: string) => void;
  t: (en: string, es: string) => string;
}) {
  const [sending, setSending] = useState(false);
  // Which SMS provider (if any) the server is configured to send through.
  const [smsProvider, setSmsProvider] = useState<string | null | undefined>(undefined);
  const phoneDigits = telClean(order.delivery_phone).replace(/[^\d+]/g, "");
  const hasPhone = phoneDigits.replace(/\D/g, "").length >= 7;

  useEffect(() => {
    let alive = true;
    fetch("/api/notify")
      .then((r) => r.json())
      .then((d) => { if (alive) setSmsProvider(d.sms ?? null); })
      .catch(() => { if (alive) setSmsProvider(null); });
    return () => { alive = false; };
  }, []);

  const buildMessage = () => {
    const url = `${location.origin}/track/${order.id}`;
    const who = order.contact ? `${order.contact}, ` : "";
    // Include the estimated delivery date + time window when we have them.
    const date = order.delivery_date ? fmtDate(order.delivery_date) : "";
    const win = order.delivery_windows ? ` ${order.delivery_windows}` : "";
    const whenEn = date ? ` for ${date}${win}` : "";
    const whenEs = date ? ` para el ${date}${win}` : "";
    return t(
      `Hi ${who}your RDZ delivery #${order.order_no} is scheduled${whenEn}. Track it live here: ${url}`,
      `Hola ${who}su entrega RDZ #${order.order_no} está programada${whenEs}. Siga su estado aquí: ${url}`,
    );
  };

  const openSms = () => {
    const body = encodeURIComponent(buildMessage());
    // "sms:NUMBER?&body=..." is the form both iOS and Android accept.
    window.location.href = `sms:${phoneDigits}?&body=${body}`;
  };

  const openWhatsApp = () => {
    const num = phoneDigits.replace(/\D/g, "");
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(buildMessage())}`, "_blank", "noopener");
  };

  const autoSms = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel: "sms", to: phoneDigits, message: buildMessage() }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.ok) notify(t(`Tracking SMS sent via ${body.provider || "SMS"}`, `SMS de seguimiento enviado por ${body.provider || "SMS"}`));
      else if (body.dryRun) notify(t("RingCentral isn’t set up yet — add the keys in .env.local and restart.", "RingCentral aún no está configurado — agregue las claves en .env.local y reinicie."));
      else notify(body.error || t("Could not send SMS", "No se pudo enviar el SMS"));
    } catch {
      notify(t("Network error sending SMS", "Error de red al enviar el SMS"));
    } finally {
      setSending(false);
    }
  };

  const configured = smsProvider != null;

  return (
    <div style={{ marginTop: 14 }}>
      <div className="section-label" style={{ marginTop: 0 }}>{t("Send live tracking to customer", "Enviar seguimiento al cliente")}</div>
      {hasPhone ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {/* Primary path: server-side send — works on desktop, no phone app needed. */}
            <button className="btn btn-primary btn-sm" onClick={autoSms} disabled={sending || smsProvider === undefined}
              title={configured ? t("Send now via RingCentral", "Enviar ahora por RingCentral") : t("Set up RingCentral in .env.local first", "Configure RingCentral en .env.local primero")}>
              {sending ? t("Sending…", "Enviando…") : `📨 ${t("Send SMS", "Enviar SMS")}${smsProvider ? ` (${smsProvider})` : ""}`}
            </button>
            <button className="btn btn-green btn-sm" onClick={openWhatsApp}>🟢 WhatsApp</button>
            {/* sms: only helps on a phone; offered as a secondary "open SMS app". */}
            <button className="btn btn-ghost btn-sm" onClick={openSms} title={t("Opens your device's SMS app (phone only)", "Abre la app de SMS del dispositivo (solo teléfono)")}>💬 {t("SMS app", "App SMS")}</button>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {smsProvider === undefined
              ? t("Checking SMS setup…", "Comprobando configuración de SMS…")
              : configured
                ? t(`✅ Server SMS is ready (${smsProvider}) — “Send SMS” delivers straight from your desktop.`, `✅ SMS por servidor listo (${smsProvider}) — “Enviar SMS” envía directamente desde el escritorio.`)
                : t("⚠ RingCentral not configured — “Send SMS” won’t work from the desktop until you add the keys in .env.local and restart. WhatsApp works now.", "⚠ RingCentral no configurado — “Enviar SMS” no funcionará desde el escritorio hasta agregar las claves en .env.local y reiniciar. WhatsApp funciona ahora.")}
          </div>
        </>
      ) : (
        <div className="hint">{t("Add a delivery phone number to text the customer their tracking link.", "Agregue un teléfono de entrega para enviar el enlace de seguimiento al cliente.")}</div>
      )}
    </div>
  );
}

// One-tap navigation: hands the trip (pickup → delivery) off to the driver's
// maps app. Google Maps builds full turn-by-turn directions from origin →
// destination; Waze navigates to the dropoff. Opens the native app on a phone.
function NavButtons({ origin, destination, t }: { origin: string; destination: string; t: (en: string, es: string) => string }) {
  const gmaps =
    "https://www.google.com/maps/dir/?api=1" +
    (origin ? `&origin=${encodeURIComponent(origin)}` : "") +
    `&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  const waze = `https://www.waze.com/ul?q=${encodeURIComponent(destination)}&navigate=yes`;
  const open = (url: string) => window.open(url, "_blank", "noopener");
  return (
    <div style={{ marginTop: 14 }}>
      <div className="section-label" style={{ marginTop: 0 }}>{t("Navigation", "Navegación")}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={() => open(gmaps)}>🧭 {t("Navigate (Google Maps)", "Navegar (Google Maps)")}</button>
        <button className="btn btn-ghost" onClick={() => open(waze)}>{t("Open in Waze", "Abrir en Waze")}</button>
      </div>
      <div className="hint">{t("Opens your maps app with the route to the delivery.", "Abre tu app de mapas con la ruta a la entrega.")}</div>
    </div>
  );
}

// Human label for an activity-log event. Stage kinds reuse the stage labels;
// created/edited get their own wording.
function eventLabel(kind: string, lang: "en" | "es"): string {
  if (kind === "created") return lang === "es" ? "Creada" : "Created";
  if (kind === "edited") return lang === "es" ? "Editada" : "Edited";
  if (kind === "note") return lang === "es" ? "💬 Nota" : "💬 Note";
  const s = stageInfo(kind);
  if (s.key === kind) return stageLabel(kind, lang);
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

// ---- Small field helpers --------------------------------------------------
function Txt({ label, val, on, type = "text", disabled, placeholder, invalid }: {
  label: string; val: unknown; on: (v: string) => void; type?: string; disabled?: boolean; placeholder?: string; invalid?: boolean;
}) {
  return (
    <div className="field">
      <label>{label}{invalid && <span className="req-star"> *</span>}</label>
      <input className={invalid ? "invalid" : ""} type={type} value={(val as string) ?? ""} disabled={disabled} placeholder={placeholder}
        onChange={(e) => on(e.target.value)} />
    </div>
  );
}

const NEW_ACCOUNT = "__new__";

/** Account — same "pick a saved one, or type a new one" pattern as the
 * Dropoff field. Options are every account name already seen; the parent's
 * `on` callback looks up a saved contact/phone for the picked name and
 * fills those fields too, the same way a saved pickup/dropoff fills its
 * address. */
function AccountCombo({ val, on, options, disabled, placeholder, t }: {
  val: unknown; on: (v: string) => void;
  options: string[]; disabled?: boolean; placeholder?: string;
  t: (en: string, es: string) => string;
}) {
  const current = (val as string) ?? "";
  const known = options.includes(current);
  const [manual, setManual] = useState(!!current && !known);

  return (
    <div className="field">
      <label>{t("Account", "Cuenta")}</label>
      {manual ? (
        <div style={{ display: "flex", gap: 8 }}>
          <input value={current} disabled={disabled} placeholder={placeholder} onChange={(e) => on(e.target.value)} />
          {options.length > 0 && (
            <button className="btn btn-ghost btn-sm" disabled={disabled} onClick={() => { setManual(false); on(""); }}>
              {t("Pick saved", "Elegir guardado")}
            </button>
          )}
        </div>
      ) : (
        <select
          value={known ? current : ""}
          disabled={disabled}
          onChange={(e) => {
            if (e.target.value === NEW_ACCOUNT) { setManual(true); on(""); return; }
            on(e.target.value);
          }}
        >
          <option value="">{placeholder ?? t("Select…", "Seleccione…")}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value={NEW_ACCOUNT}>➕ {t("Type a new one…", "Escribir uno nuevo…")}</option>
        </select>
      )}
    </div>
  );
}

/** Delivery Time Windows — a fixed preset list (Early Morning / Morning /
 * Afternoon / All Day) instead of free text. Falls back to showing the raw
 * value as a "Custom" option so existing orders with a non-preset window
 * (e.g. from before this changed) still display correctly. */
function WindowSel({ val, on, disabled, invalid, t }: {
  val: unknown; on: (v: string) => void; disabled?: boolean; invalid?: boolean; t: (en: string, es: string) => string;
}) {
  const current = (val as string) ?? "";
  const isCustom = current && !DELIVERY_WINDOW_PRESETS.some((p) => p.value === current);
  return (
    <div className="field">
      <label>{t("Delivery Time Window", "Ventana de Entrega")}{invalid && <span className="req-star"> *</span>}</label>
      <select className={invalid ? "invalid" : ""} value={current} disabled={disabled} onChange={(e) => on(e.target.value)}>
        <option value="">{t("Select a window…", "Seleccione una ventana…")}</option>
        {DELIVERY_WINDOW_PRESETS.map((p) => <option key={p.key} value={p.value}>{t(p.en, p.es)}</option>)}
        {isCustom && <option value={current}>{t("Custom", "Personalizada")}: {current}</option>}
      </select>
    </div>
  );
}

function Sel({ label, val, opts, on, disabled, placeholder, invalid }: {
  label: string; val: unknown; opts: string[]; on: (v: string) => void; disabled?: boolean; placeholder?: string; invalid?: boolean;
}) {
  const list = useMemo(() => opts ?? [], [opts]);
  return (
    <div className="field">
      <label>{label}{invalid && <span className="req-star"> *</span>}</label>
      <select className={invalid ? "invalid" : ""} value={(val as string) ?? ""} disabled={disabled} onChange={(e) => on(e.target.value)}>
        <option value="">{placeholder ?? "—"}</option>
        {list.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

export { fmtMilitary };
