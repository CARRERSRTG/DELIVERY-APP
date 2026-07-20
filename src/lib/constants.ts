import type { Stage, UserRole } from "./types";
import type { Lang } from "./prefs";

// App version shown in the footer on every screen. Keep in sync with package.json.
export const APP_VERSION = "0.2.13";

// ---- Workflow stages (source of truth for labels, colors, order) ----------
export interface StageInfo {
  key: Stage;
  label: string;
  color: string;
  // Which board group a stage belongs to (for filtering chips).
  group: "sales" | "approval" | "warehouse" | "done";
}

export const STAGES: StageInfo[] = [
  { key: "draft",      label: "Draft",          color: "#6b7686", group: "sales" },
  { key: "pending",    label: "Pending Approval", color: "#e9a13b", group: "approval" },
  { key: "rejected",   label: "Rejected",       color: "#d64545", group: "approval" },
  { key: "approved",   label: "Approved",       color: "#2456c9", group: "warehouse" },
  { key: "fulfilling", label: "Fulfilling",     color: "#7c4dbc", group: "warehouse" },
  { key: "ready",      label: "Ready",          color: "#0f8a8a", group: "warehouse" },
  { key: "picked_up",  label: "Picked Up",      color: "#d1782e", group: "warehouse" },
  { key: "delivered",  label: "Delivered",      color: "#1f9d61", group: "done" },
  { key: "canceled",   label: "Canceled",       color: "#9aa3b0", group: "done" },
];

export function stageInfo(key: string): StageInfo {
  return STAGES.find((s) => s.key === key) ?? STAGES[0];
}

// Spanish stage labels + a language-aware lookup used across the UI.
export const STAGE_ES: Record<Stage, string> = {
  draft: "Borrador",
  pending: "Pendiente",
  rejected: "Rechazado",
  approved: "Aprobado",
  fulfilling: "Preparando",
  ready: "Listo",
  picked_up: "Recogido",
  delivered: "Entregado",
  canceled: "Cancelado",
};

export function stageLabel(key: string, lang: Lang): string {
  const info = stageInfo(key);
  return lang === "es" ? STAGE_ES[info.key] ?? info.label : info.label;
}

// ---- Navigation tabs ------------------------------------------------------
// `roles` = who sees the tab by default. `cap` = the capability that also
// unlocks it, so an admin can grant one person access without changing role.
export const TABS: { id: string; label: string; label_es: string; href: string; roles?: UserRole[]; cap?: Capability }[] = [
  // Warehouse works entirely inside its own queue — it doesn't get the
  // general Orders board, dashboard, accounts, or the driver view.
  // Driver doesn't get the Orders board either — they work entirely from
  // their own Driver view, which has its own "+ New order" button.
  { id: "board",     label: "📋 Orders",    label_es: "📋 Órdenes",   href: "/", roles: ["admin", "manager", "sales"] },
  { id: "dashboard", label: "📊 Dashboard", label_es: "📊 Panel",     href: "/dashboard", roles: ["manager", "admin"], cap: "dashboard" },
  { id: "accounts",  label: "🏢 Accounts",  label_es: "🏢 Cuentas",    href: "/accounts", roles: ["admin", "manager"] },
  { id: "map",       label: "🗺 Map",       label_es: "🗺 Mapa",       href: "/map", roles: ["admin", "manager", "sales"] },
  { id: "warehouse", label: "🏭 Warehouse", label_es: "🏭 Almacén",    href: "/warehouse", roles: ["warehouse", "admin"], cap: "fulfill" },
  { id: "driver",    label: "🚚 Driver",    label_es: "🚚 Chofer",     href: "/driver", roles: ["driver", "admin"], cap: "deliver" },
  { id: "data",      label: "🗂 Data",      label_es: "🗂 Datos",      href: "/data", roles: ["admin"], cap: "settings" },
  { id: "settings",  label: "⚙️ Settings",  label_es: "⚙️ Ajustes",    href: "/settings", roles: ["admin"], cap: "settings" },
  { id: "users",     label: "🛡 Users",     label_es: "🛡 Usuarios",   href: "/users", roles: ["admin"], cap: "users" },
  // Personal work summary — not shown to sales/manager (redundant with their
  // Orders default view) or warehouse (outside its restricted nav).
  { id: "summary",   label: "📈 Summary",   label_es: "📈 Resumen",    href: "/summary", roles: ["admin", "driver"] },
  // Available to every role — each user's own profile and preferences.
  { id: "account",   label: "👤 Account",   label_es: "👤 Cuenta",     href: "/account" },
];

// ---- Role metadata --------------------------------------------------------
export const ROLE_INFO: Record<UserRole, { label: string; label_es: string; color: string; desc: string; desc_es: string }> = {
  admin:     { label: "Admin",          label_es: "Administrador",     color: "var(--red)",    desc: "Full access + manage users",               desc_es: "Acceso total + gestión de usuarios" },
  manager:   { label: "Office Manager", label_es: "Gerente de Oficina", color: "var(--purple)", desc: "Approves & rejects submitted orders",      desc_es: "Aprueba y rechaza órdenes enviadas" },
  sales:     { label: "Salesperson",    label_es: "Vendedor",          color: "var(--accent)", desc: "Creates orders and submits for approval",  desc_es: "Crea órdenes y las envía a aprobación" },
  warehouse: { label: "Warehouse",      label_es: "Almacén",           color: "var(--teal)",   desc: "Fulfills approved orders",                 desc_es: "Prepara las órdenes aprobadas" },
  driver:    { label: "Driver",         label_es: "Chofer",            color: "var(--amber)",  desc: "Delivers orders and can log new ones",     desc_es: "Entrega órdenes y puede registrar nuevas" },
};

export function roleLabel(role: UserRole, lang: Lang): string {
  return lang === "es" ? ROLE_INFO[role].label_es : ROLE_INFO[role].label;
}

export const ROLE_ORDER: UserRole[] = ["admin", "manager", "sales", "warehouse", "driver"];

// ---- Delivery time window presets ------------------------------------------
// Same "HHMM-HHMM" string format the rest of the app already parses
// (scheduling conflicts, driver routing) — only the picker is a fixed list
// now instead of free text.
export interface WindowPreset { key: string; en: string; es: string; value: string }
export const DELIVERY_WINDOW_PRESETS: WindowPreset[] = [
  { key: "early_morning", en: "Early Morning (6-9)", es: "Madrugada (6-9)", value: "0600-0900" },
  { key: "morning",       en: "Morning (9-12)",       es: "Mañana (9-12)",   value: "0900-1200" },
  { key: "afternoon",     en: "Afternoon (12-5)",      es: "Tarde (12-5)",    value: "1200-1700" },
  { key: "all_day",       en: "All Day (8-3)",         es: "Todo el día (8-3)", value: "0800-1500" },
];

// ---- Per-role default Orders-table columns ---------------------------------
// Falls back to OrdersTable's own DEFAULT_COLUMNS for any role not listed
// here. Sales sees invoice # instead of the internal SO #, and no driver
// column on the main view (still available via the Columns picker).
export const ROLE_DEFAULT_COLUMNS: Partial<Record<UserRole, string[]>> = {
  sales: ["type", "store", "invoice", "date", "windows", "account"],
};

/** Drivers come from the Users list — anyone with the "driver" role. They're
 * people, so they're managed in Users (one source of truth), not Settings. */
export function driverNames(users: { full_name: string; role: UserRole }[]): string[] {
  return users
    .filter((u) => u.role === "driver")
    .map((u) => u.full_name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

// ---- "What I can do" — per-role capability list -------------------------
// Shown on each user's Account page. These are the defaults; an admin can
// edit / add to them in Settings, which stores overrides in
// settings.role_permissions. Bilingual until customized (custom entries are
// free text, shown verbatim in both languages).
export const DEFAULT_PERMISSIONS: Record<UserRole, { en: string; es: string }[]> = {
  admin: [
    { en: "Everything", es: "Todo" },
    { en: "Manage users", es: "Gestionar usuarios" },
    { en: "Settings", es: "Ajustes" },
    { en: "Override any status", es: "Cambiar cualquier estado" },
  ],
  manager: [
    { en: "Create orders", es: "Crear órdenes" },
    { en: "Approve orders", es: "Aprobar órdenes" },
    { en: "Reject with a reason", es: "Rechazar con motivo" },
    { en: "See every order", es: "Ver todas las órdenes" },
    { en: "Dashboard", es: "Panel" },
  ],
  sales: [
    { en: "Create orders", es: "Crear órdenes" },
    { en: "Submit for approval", es: "Enviar a aprobación" },
    { en: "Resubmit rejected", es: "Reenviar rechazadas" },
    { en: "Send tracking links", es: "Enviar enlaces de seguimiento" },
  ],
  warehouse: [
    { en: "Fulfill approved orders", es: "Preparar órdenes aprobadas" },
    { en: "Set prepared status", es: "Marcar preparación" },
    { en: "Confirm pallets", es: "Confirmar tarimas" },
    { en: "Mark ready", es: "Marcar listo" },
  ],
  driver: [
    { en: "Pick up & deliver", es: "Recoger y entregar" },
    { en: "Capture signatures", es: "Capturar firmas" },
    { en: "Navigate to stops", es: "Navegar a las paradas" },
    { en: "Log new orders", es: "Registrar órdenes" },
  ],
};

/** The default capability list for a role, in the given language. */
export const defaultPermissions = (role: UserRole, lang: Lang): string[] =>
  DEFAULT_PERMISSIONS[role].map((p) => (lang === "es" ? p.es : p.en));

/** The capability list to display: admin overrides win, else the defaults. */
export function permissionsFor(
  role: UserRole,
  lang: Lang,
  overrides?: Partial<Record<UserRole, string[]>> | null,
): string[] {
  const custom = overrides?.[role];
  return custom && custom.length ? custom : defaultPermissions(role, lang);
}

// ---- Capabilities ---------------------------------------------------------
// What someone is allowed to DO. Each role grants a default set; an admin can
// additionally grant capabilities to an INDIVIDUAL user (Profile.permissions),
// e.g. a salesperson who is also allowed to approve. Grants only ever add —
// they never take away what the role already allows.
export type Capability = "create" | "approve" | "fulfill" | "deliver" | "dashboard" | "users" | "settings";

export const CAPABILITIES: { key: Capability; en: string; es: string; desc_en: string; desc_es: string }[] = [
  { key: "create",    en: "Create orders",    es: "Crear órdenes",       desc_en: "Log new orders and submit them for approval", desc_es: "Registrar órdenes y enviarlas a aprobación" },
  { key: "approve",   en: "Approve orders",   es: "Aprobar órdenes",     desc_en: "Approve or reject pending orders",            desc_es: "Aprobar o rechazar órdenes pendientes" },
  { key: "fulfill",   en: "Fulfill orders",   es: "Preparar órdenes",    desc_en: "Warehouse queue: prepare and mark ready",     desc_es: "Cola de almacén: preparar y marcar listo" },
  { key: "deliver",   en: "Deliver orders",   es: "Entregar órdenes",    desc_en: "Pick up, deliver and capture signatures",     desc_es: "Recoger, entregar y capturar firmas" },
  { key: "dashboard", en: "View dashboard",   es: "Ver panel",           desc_en: "See company-wide KPIs and reports",           desc_es: "Ver KPIs y reportes de la empresa" },
  { key: "users",     en: "Manage users",     es: "Gestionar usuarios",  desc_en: "Invite people and change their roles",        desc_es: "Invitar personas y cambiar sus roles" },
  { key: "settings",  en: "Change settings",  es: "Cambiar ajustes",     desc_en: "Edit workspace settings and pick-lists",      desc_es: "Editar ajustes y listas del espacio" },
];

/** The capabilities each role gets automatically. */
export const ROLE_CAPS: Record<UserRole, Capability[]> = {
  admin:     ["create", "approve", "fulfill", "deliver", "dashboard", "users", "settings"],
  manager:   ["create", "approve", "dashboard"],
  sales:     ["create"],
  warehouse: ["fulfill", "deliver"],
  driver:    ["create", "deliver"],
};

/** Minimal shape needed to test a capability. */
export interface CapUser { role: UserRole; permissions?: string[] | null }

/** Does this user have the capability — via their role, or an admin grant? */
export function hasCap(u: CapUser | null | undefined, cap: Capability): boolean {
  if (!u) return false;
  if (ROLE_CAPS[u.role]?.includes(cap)) return true;
  return !!u.permissions?.includes(cap);
}

/** Extra capabilities granted to this user beyond what their role already gives. */
export function extraCaps(u: CapUser): Capability[] {
  const base = ROLE_CAPS[u.role] ?? [];
  return (u.permissions ?? []).filter((p): p is Capability => !base.includes(p as Capability));
}

// ---- Permissions helpers --------------------------------------------------
export const canCreate = (u: CapUser) => hasCap(u, "create");
export const canApprove = (u: CapUser) => hasCap(u, "approve");
export const canFulfill = (u: CapUser) => hasCap(u, "fulfill");
export const canDeliver = (u: CapUser) => hasCap(u, "deliver");

// ---- Workflow transition guard -------------------------------------------
// The only legal stage moves. Enforced in BOTH data providers so an order can
// never reach the warehouse (fulfilling/ready/delivered) without first being
// approved by a manager — no matter how setStage is called.
const LEGAL_TRANSITIONS: Record<Stage, Stage[]> = {
  draft:      ["pending", "canceled"],
  pending:    ["approved", "rejected"],
  rejected:   ["pending", "canceled"],
  approved:   ["fulfilling", "pending"],   // pending = manager "unlock"
  fulfilling: ["ready"],
  ready:      ["picked_up"],               // driver collects the order
  picked_up:  ["delivered", "ready"],      // driver delivers (or reverts if not taken)
  delivered:  [],
  canceled:   [],
};

export function canTransition(from: Stage, to: Stage): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Can this role edit the order's data fields while it sits in `stage`? */
export function canEditFields(r: UserRole, stage: Stage): boolean {
  if (r === "admin") return true;
  // Sales can only edit while an order is Pending Approval or Rejected —
  // NOT Draft. A brand-new order is still editable (isNew bypasses this
  // check entirely in OrderModal), but once a draft is saved, a sales rep
  // must submit it for approval before touching it again.
  if (r === "sales") return stage === "pending" || stage === "rejected";
  if (r === "warehouse") return ["approved", "fulfilling", "ready", "picked_up", "delivered"].includes(stage);
  if (r === "driver") return stage === "draft" || stage === "pending" || stage === "rejected";
  if (r === "manager") return true;
  return false;
}
