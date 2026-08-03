// ---- Roles ----------------------------------------------------------------
export type UserRole = "admin" | "manager" | "sales" | "warehouse" | "driver" | "logistics";

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  /** Extra capabilities granted to this specific person by an admin, on top of
   * whatever their role already allows (see Capability in lib/constants). */
  permissions?: string[] | null;
  // Store a warehouse worker / driver belongs to. Scopes what they see
  // (they only handle orders picked up from their store). null for others.
  store?: string | null;
  avatar_url?: string | null;
}

// ---- Workflow stages ------------------------------------------------------
// draft → pending → approved → fulfilling → ready → delivered
// off-ramps: rejected (manager), canceled
export type Stage =
  | "draft"
  | "pending"
  | "approved"
  | "rejected"
  | "fulfilling"
  | "ready"
  | "picked_up"
  | "delivered"
  | "canceled";

// ---- Delivery order -------------------------------------------------------
export interface Delivery {
  id: string;
  order_no: number;
  /** Split-load letter. When a driver can only load part of an order, it
   * splits: the loaded part becomes e.g. #1001a and the remainder is a new
   * linked order #1001b (same order_no, next letter). Null = never split. */
  order_suffix: string | null;

  stage: Stage;
  rejected_reason: string | null;
  /** True for orders created in Teaching (training) mode — kept in the same
   * table but shown only while teaching mode is on. */
  is_training: boolean;

  // Re-delivery tracking: when an order has to be delivered again (warehouse
  // error, damage, etc.) it's re-recorded as a NEW order linked to the original,
  // with a reason — so repeats are measurable for the end-of-week review.
  redelivery_of: string | null;       // original delivery id, or null
  redelivery_reason: string | null;

  // Data columns (from the spec)
  prepared_status: string | null;
  status_temp: string | null;
  order_type: string | null;
  store: string | null;
  po2: string | null;
  so_num: string | null;
  invoice_num: string | null;
  input_date: string | null;
  input_time: string | null;
  delivery_date: string | null;
  pickup_name: string | null;
  pickup_address: string | null;
  pickup_duration: string | null;
  // What the salesperson is charging the customer for this delivery (USD).
  delivery_fee: number | null;
  est_pallets: number | null;        // estimated by sales
  actual_pallets: number | null;      // revised/confirmed by warehouse
  assigned_driver: string | null;
  /** This order's stop position (0-based) in its driver's route for the day,
   * set by the Logistics Manager's route optimizer. null = not sequenced yet
   * (newly assigned, or the driver's route hasn't been optimized/reordered). */
  route_seq: number | null;
  delivery_duration: string | null;
  /** Named dropoff point (saved site name), paired with delivery_address. */
  delivery_name: string | null;
  delivery_address: string | null;
  delivery_windows: string | null;
  account: string | null;
  contact: string | null;
  delivery_phone: string | null;
  delivery_notes: string | null;

  // Auto-computed route (pickup → delivery) from the routing service.
  route_miles: number | null;
  route_duration: string | null;   // e.g. "1 h 12 min"
  route_provider: string | null;   // Google Maps / Mapbox / OpenStreetMap
  route_traffic: boolean | null;   // true when the ETA includes live traffic

  // Proof of delivery (captured by the driver at the doorstep).
  pod_received_by: string | null;   // who signed for it
  pod_signature: string | null;     // signature image as a data: URL
  pod_delivered_at: string | null;  // when it was actually handed over
  /** Photos of the material taken by the driver (data: URLs), e.g. the load on
   * the truck or the goods dropped at the door. */
  photos: string[] | null;

  // When the driver set off toward the pickup (drive-to-pickup leg). Used as
  // the start of "active" time for the idle-time KPI when present.
  departed_at: string | null;
  // GPS stamps — where the driver actually was at each milestone. Captured from
  // the device at the moment of the action (no continuous tracking).
  pickup_lat: number | null;
  pickup_lng: number | null;
  pickup_gps_at: string | null;
  pod_lat: number | null;
  pod_lng: number | null;
  pod_accuracy: number | null;      // metres of uncertainty reported by the device

  // Planned delivery location, for the dispatch map + driver navigation.
  // Auto-geocoded from delivery_address and cached here the first time the
  // map needs it — OR set manually (a dropped pin) when there's no real
  // address yet, e.g. a construction site. "manual" pins are never
  // overwritten by re-geocoding.
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_pin_source: "geocoded" | "manual" | null;

  created_by: string | null;
  /** Set when an office/admin/driver creates the order on behalf of a sales
   * rep (see OrderModal's Sales Rep picker). `created_by` always stays the
   * actual creator; this is who the order is FOR — see lib/utils.ts's
   * orderOwner() for the one place that resolves "whose order is this". */
  assigned_sales_rep: string | null;
  approved_by: string | null;
  approved_at: string | null;
  /** Customer satisfaction on a delivered order: 1–5 stars + an optional note.
   * Recorded from the order form. Feeds the CSAT KPI. */
  csat_rating?: number | null;
  csat_comment?: string | null;
  created_at: string;
  updated_at: string;
}

/** A window when a driver is unavailable (vacation / sick / vehicle
 * maintenance / other). Consumed by the dispatch board + optimizer. */
export interface DriverAvailability {
  id: string;
  driver_id: string;
  kind: "vacation" | "sick" | "maintenance" | "other";
  start_date: string;
  end_date: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

// A driver work session: clock-in → clock-out. ended_at null means the driver
// is on the clock right now. Idle time = on-clock time minus time actively
// working a delivery (pickup → delivered).
export interface DriverShift {
  id: string;
  driver_id: string;
  started_at: string;
  ended_at: string | null;
  note: string | null;
  created_at: string;
}

export interface OrderEvent {
  id: string;
  delivery_id: string;
  kind: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

/** A named place with a map-searchable address (stores, driver home bases). */
export interface NamedLocation {
  name: string;
  address: string;
  /** Stores only: when true, orders sold from this store skip manager approval
   * and are created already Approved. Undefined/false = normal approval flow. */
  auto_approve?: boolean;
}

/** A saved customer/site account — picking it on an order auto-fills who to
 * contact there, the same way picking a saved pickup/dropoff fills its address. */
export interface AccountRecord {
  name: string;
  contact: string;
  phone: string;
}

export interface Settings {
  id: number;
  app_name: string;
  stores: NamedLocation[];
  order_types: string[];
  /** Saved pickup points (warehouses, yards, suppliers). Picking a name fills
   * the address; a new one typed on an order can be saved back here. */
  pickup_locations?: NamedLocation[];
  /** Saved dropoff points (recurring customer sites, job sites). */
  delivery_locations?: NamedLocation[];
  /** Saved accounts — picking one on an order auto-fills its contact name
   * + phone. A new account typed on an order can be saved back here. */
  accounts?: AccountRecord[];
  // NOTE: drivers are NOT stored here — they're users with the "driver" role.
  // Use driverNames(users) from lib/constants. Keeping them in one place stops
  // the Settings list and the Users list drifting apart.
  // Minutes of duration added per pallet, used to auto-calculate the
  // pickup and delivery durations on each order. Editable by admins.
  pickup_min_per_pallet: number;
  delivery_min_per_pallet: number;

  // ---- RingCentral integrations (opt-in, OFF by default) ----
  // Both cost money / contact customers, so nothing fires unless an admin
  // deliberately turns it on here.
  /** Show the "Call via RingCentral" (RingOut) buttons. */
  rc_calls_enabled: boolean;
  /** Automatically text the customer their tracking link when an order is created. */
  rc_auto_sms_enabled: boolean;

  /** Admin-editable "What I can do" list per role, shown on each Account page.
   * Absent / empty for a role = fall back to the built-in bilingual defaults. */
  role_permissions?: Partial<Record<UserRole, string[]>>;

  // ---- End-of-day pending-approval deadline (configurable) ----
  // Once it's this time of day and an order is still "pending", its row
  // turns red and an escalation notification fires: managers first, then
  // (a bit later) the sales rep who submitted it. Both "HH:MM", 24h.
  manager_pending_cutoff?: string;
  sales_pending_cutoff?: string;

  /** Named driver colors for the delivery map (assigned by a manager/admin in
   * Settings). Driver full name → any CSS color string. */
  driver_colors?: Record<string, string>;

  /** Each driver's truck capacity in pallets, set by Logistics/admin in the
   * Routes tool. When a driver's assigned pallets exceed this, the route
   * optimizer splits their day into multiple round trips back to their home
   * store to reload. Driver full name → pallet count. */
  driver_capacity?: Record<string, number>;

  /** Fixed Orders-table columns for the Sales role, set by an admin in Settings.
   * Sales reps get no "Columns" picker of their own — this is the one list
   * they see, company-wide. Falls back to ROLE_DEFAULT_COLUMNS.sales if unset. */
  sales_columns?: string[] | null;

  /** Where the in-app Help button sends its emails. Any user can tap Help to
   * email this address; an admin sets it in Settings. Falls back to
   * DEFAULT_HELP_EMAIL when unset. */
  help_email?: string;

  /** Per-user customer visibility on the Accounts page, set by an admin on the
   * Users page. "all" = sees every customer (with a Mine/All toggle); "own" =
   * only customers from orders they own. User id → scope. Missing = "all"
   * (preserves the previous behavior for Manager/Logistics). */
  customer_scope?: Record<string, "all" | "own">;

  // ---- Delivery cost model (Epic D) — drives the fuel-cost / cost-per-delivery
  // KPIs, derived from each order's route_miles. All optional; a KPI shows "—"
  // until the pieces it needs are set. ----
  /** Fuel price, $ per gallon. */
  fuel_price?: number | null;
  /** Fleet average fuel economy, miles per gallon. */
  fleet_mpg?: number | null;
  /** Flat overhead cost charged per delivery/stop, in $. */
  cost_per_delivery?: number | null;

  /** Market Map prospect CRM — status per external place id (Google/OSM).
   * A lightweight sales tracker layered over the live places. */
  prospect_status?: Record<string, {
    status: "contacted" | "interested" | "partner" | "not_interested";
    note?: string | null;
    updated_at?: string;
    updated_by?: string | null;
  }>;
}
