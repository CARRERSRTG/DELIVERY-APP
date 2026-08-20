// Tabs for timetracker's own TopBar. Hrefs are prefixed /timetracker — this
// module lives under that prefix, a sibling of (app) and recruiting's
// (recruiting), never nested (D-064).
//
// Etapa 2 lands screen by screen (D-066 pass 1: Track Time; pass 2: My
// Week; pass 3: My Requests; pass 4: Work Diary + My Account — the whole
// employee side is done; pass 5: Dashboard, the first manager screen).
// Learned from D-059: a tab pointing at a page that doesn't exist yet is a
// dead link waiting to be clicked — so both lists only carry routes that
// actually resolve today.
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
// as a mode switch instead of separate routes). Manager screens still to
// come: Working now, Reports/Pay, Team requests, Projects, Assignments,
// Employees, Team diary, Audit, Settings.
export const MANAGER_TABS: { id: string; label: string; href: string }[] = [
  { id: "insights", label: "📊 Dashboard", href: "/timetracker/insights" },
  { id: "track", label: "⏱ Track Time", href: "/timetracker" },
  { id: "week", label: "📅 My Week", href: "/timetracker/week" },
  { id: "requests", label: "📝 My Requests", href: "/timetracker/requests" },
  { id: "diary", label: "🗂 Work Diary", href: "/timetracker/diary" },
  { id: "account", label: "👤 My Account", href: "/timetracker/account" },
];
