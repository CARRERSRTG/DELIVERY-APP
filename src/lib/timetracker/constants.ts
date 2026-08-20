// Tabs for timetracker's own TopBar. Hrefs are prefixed /timetracker — this
// module lives under that prefix, a sibling of (app) and recruiting's
// (recruiting), never nested (D-064).
//
// Etapa 2 landed screen by screen (D-066 through D-071) — see DECISIONS.md
// for the pass-by-pass history. Both employee and manager sides are now
// complete: 5 employee screens, 10 manager screens.
export const TABS: { id: string; label: string; href: string }[] = [
  { id: "track", label: "⏱ Track Time", href: "/timetracker" },
  { id: "week", label: "📅 My Week", href: "/timetracker/week" },
  { id: "requests", label: "📝 My Requests", href: "/timetracker/requests" },
  { id: "diary", label: "🗂 Work Diary", href: "/timetracker/diary" },
  { id: "account", label: "👤 My Account", href: "/timetracker/account" },
];

// An admin sees this instead of TABS — manager screens first, then the same
// personal ones every employee gets (an admin can track their own time too;
// the original's "View as employee" toggle covered the same ground, just
// as a mode switch instead of separate routes).
export const MANAGER_TABS: { id: string; label: string; href: string }[] = [
  { id: "insights", label: "📊 Dashboard", href: "/timetracker/insights" },
  { id: "live", label: "🟢 Working Now", href: "/timetracker/live" },
  { id: "reports", label: "💵 Reports/Pay", href: "/timetracker/reports" },
  { id: "team-requests", label: "📝 Requests", href: "/timetracker/team-requests" },
  { id: "projects", label: "📁 Projects", href: "/timetracker/projects" },
  { id: "assignments", label: "🔗 Assignments", href: "/timetracker/assignments" },
  { id: "people", label: "🧑‍🤝‍🧑 Employees", href: "/timetracker/people" },
  { id: "team-diary", label: "🗂 Work Diary", href: "/timetracker/team-diary" },
  { id: "audit", label: "📜 Audit", href: "/timetracker/audit" },
  { id: "settings", label: "⚙️ Settings", href: "/timetracker/settings" },
  { id: "track", label: "⏱ Track Time", href: "/timetracker" },
  { id: "week", label: "📅 My Week", href: "/timetracker/week" },
  { id: "requests", label: "📝 My Requests", href: "/timetracker/requests" },
  { id: "diary", label: "🗂 Work Diary", href: "/timetracker/diary" },
  { id: "account", label: "👤 My Account", href: "/timetracker/account" },
];
