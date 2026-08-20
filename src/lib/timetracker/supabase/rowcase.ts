// Shallow snake_case <-> camelCase row conversion. Postgres columns are
// snake_case; every ported timetracker screen (mechanically translated from
// the original Vite app) reads/writes camelCase, exactly as it always did —
// see D-066 for why this module keeps that convention instead of switching
// to the snake_case shape recruiting-data-provider.tsx uses. One level deep
// only: jsonb columns (payload, lines, adjustments, break_events) pass
// through untouched, since their keys are free-form app data, not columns.

function toCamelKey(k: string): string {
  return k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
function toSnakeKey(k: string): string {
  return k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
}

export function rowToCamel<T = Record<string, unknown>>(row: Record<string, unknown> | null): T | null {
  if (!row) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamelKey(k)] = v;
  return out as T;
}

export function toSnakeRow(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[toSnakeKey(k)] = v;
  return out;
}
