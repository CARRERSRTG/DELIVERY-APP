// Tabs for timetracker's own TopBar. Hrefs are prefixed /timetracker — this
// module lives under that prefix, a sibling of (app) and recruiting's
// (recruiting), never nested (D-064).
//
// Etapa 2 lands screen by screen (D-066 pass 1: Track Time; pass 2: My
// Week). Learned from D-059: a tab pointing at a page that doesn't exist
// yet is a dead link waiting to be clicked — so TABS only lists routes
// that actually resolve today. Employee tabs still to come: My requests,
// Work diary, My account. Manager tabs still to come: Dashboard, Working
// now, Reports/Pay, Requests, Projects, Assignments, Employees, Work
// diary, Audit, Settings.
export const TABS: { id: string; label: string; href: string }[] = [
  { id: "track", label: "⏱ Track Time", href: "/timetracker" },
  { id: "week", label: "📅 My Week", href: "/timetracker/week" },
];
