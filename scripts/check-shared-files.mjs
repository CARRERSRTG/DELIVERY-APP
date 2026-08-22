#!/usr/bin/env node
// Pre-commit reminder (D-087) — SOLO imprime un aviso. Nunca bloquea el
// commit, nunca decide, nunca sube ninguna versión por sí solo. Si el commit
// tocó algo fuera de las tres carpetas propias de cada app, recuerda revisar
// src/lib/app-versions.ts antes de que la decisión de "cuál app subir" se
// pierda entre el resto del trabajo.

import { execSync } from "node:child_process";

const APP_OWNED_DIRS = [
  "src/app/(app)/",
  "src/app/recruiting/(recruiting)/",
  "src/app/timetracker/(timetracker)/",
  "src/lib/recruiting/",
  "src/lib/timetracker/",
];
const APP_OWNED_FILES = [
  "src/lib/data-provider.tsx",
  "src/lib/recruiting-data-provider.tsx",
  "src/lib/timetracker-data-provider.tsx",
];

function isAppOwned(file) {
  return APP_OWNED_FILES.includes(file) || APP_OWNED_DIRS.some((dir) => file.startsWith(dir));
}

const staged = execSync("git diff --cached --name-only", { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const shared = staged.filter((f) => !isAppOwned(f));

if (shared.length > 0) {
  console.log("\n\x1b[33m⚠️  Tocaste archivos compartidos:\x1b[0m");
  for (const f of shared) console.log("   - " + f);
  console.log("¿Subes 1 app o las 3? Revisa src/lib/app-versions.ts.\n");
}

process.exit(0); // nunca bloquea el commit
