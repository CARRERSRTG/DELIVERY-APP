// Keeps the two growing halves of the Notion documentation in sync with the
// repository: the ADR database mirrors DECISIONS.md, and the Changelog
// database mirrors git log.
//
//   NOTION_TOKEN=ntn_... node scripts/notion/sync.mjs
//
// It only ever ADDS. Nothing is rewritten and nothing is deleted, which is the
// point: the history is the value. Safe to run as many times as you like — a
// second run in a row does nothing.
//
// The narrative pages (Arquitectura, Estado actual, Setup, Próximos pasos) are
// NOT touched here. Those are prose about how things work today; they get
// edited by hand, in the same session as the change they describe.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { api, allRows, createRow, P } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const ids = JSON.parse(readFileSync(join(here, "ids.json"), "utf8"));

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const UNIT = String.fromCharCode(31); // field separator inside a commit
const RECORD = String.fromCharCode(30); // end of the commit metadata

const read = (rel) => readFileSync(join(repo, rel), "utf8").split(CR).join("");

// ---------------------------------------------------------------- decisiones

function parseDecisions() {
  const raw = read("DECISIONS.md");
  const out = [];
  for (const part of raw.split(/\n## (?=D-)/).slice(1)) {
    const nl = part.indexOf(LF);
    const m = part.slice(0, nl).match(/^(D-\d+)\s*·\s*(.+)$/);
    if (!m) continue; // the D-0XX template is not a decision
    const body = part.slice(nl + 1).replace(/---\s*$/, "").trim();
    const meta = body.match(
      /\*\*Fecha:\*\*\s*([\d-]+).*?\*\*Versión:\*\*\s*(\S+).*?\*\*Pedido por:\*\*\s*([^\n]+)/s,
    );
    out.push({
      id: m[1],
      title: m[2].trim(),
      date: meta?.[1] ?? null,
      version: (meta?.[2] ?? "").replace(/·$/, "").trim(),
      by: (meta?.[3] ?? "").trim(),
      body,
    });
  }
  return out;
}

async function syncDecisions() {
  const entries = parseDecisions();
  const have = new Set(
    (await allRows(ids.decisiones)).map((r) => r.properties.ID?.rich_text?.[0]?.plain_text),
  );
  const missing = entries.filter((e) => !have.has(e.id));
  console.log(`Decisiones: ${entries.length} en DECISIONS.md, ${have.size} en Notion, ${missing.length} por agregar`);

  for (const e of missing) {
    await createRow(ids.decisiones, {
      "Decisión": P.title(`${e.id} · ${e.title}`),
      "ID": P.text(e.id),
      "Fecha": P.date(e.date),
      "Versión": P.text(e.version),
      "Pedido por": P.select(e.by || "—"),
      "Estado": P.select("Vigente"),
    }, e.body);
    console.log("  +", e.id, e.title);
  }
}

// ----------------------------------------------------------------- changelog

function parseCommits() {
  const raw = execFileSync("git", [
    "-C", repo, "log", "--reverse", "--date=short",
    "--pretty=format:@@@%H" + UNIT + "%ad" + UNIT + "%s" + UNIT + "%b" + RECORD,
    "--name-only",
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split(CR).join("");

  const out = [];
  for (const chunk of raw.split("@@@").slice(1)) {
    const [meta, filesRaw = ""] = chunk.split(RECORD);
    const [hash, date, subject, body] = meta.split(UNIT);
    const files = filesRaw.split(LF).map((f) => f.trim()).filter(Boolean);
    const v = subject.match(/\(v(\d+\.\d+\.\d+)\)\s*$/);
    out.push({
      hash: hash.slice(0, 7),
      date,
      version: v?.[1] ?? null,
      title: subject.replace(/\s*\(v\d+\.\d+\.\d+\)\s*$/, "").trim(),
      body: (body ?? "").replace(/Co-Authored-By:.*/gs, "").trim(),
      files,
    });
  }
  return out;
}

const areaOf = (files) => {
  const has = (re) => files.some((f) => re.test(f));
  if (has(/^supabase\/migrations\//)) return "Base de datos";
  if (has(/^mobile\//)) return "App Android";
  if (has(/^src\/app\/api\//)) return "API";
  if (has(/^src\/lib\//)) return "Lógica";
  if (has(/^src\/(components|app)\//)) return "Interfaz";
  if (has(/^(DECISIONS\.md|CLAUDE\.md|docs\/|scripts\/|README)/)) return "Documentación";
  return "Otro";
};

async function syncChangelog() {
  const commits = parseCommits();
  const have = new Set(
    (await allRows(ids.changelog)).map((r) => r.properties.Commit?.rich_text?.[0]?.plain_text),
  );
  const missing = commits.filter((c) => !have.has(c.hash));
  console.log(`Changelog: ${commits.length} commits, ${have.size} en Notion, ${missing.length} por agregar`);

  for (const c of missing) {
    const md = [
      c.body || "_Sin descripción en el commit._",
      "",
      "---",
      "",
      `**Commit:** \`${c.hash}\` · **Fecha:** ${c.date}${c.version ? ` · **Versión:** v${c.version}` : ""}`,
      "",
      `**Archivos tocados (${c.files.length}):**`,
      ...c.files.slice(0, 60).map((f) => `- \`${f}\``),
      c.files.length > 60 ? `- …y ${c.files.length - 60} más` : "",
    ].join(LF);

    await createRow(ids.changelog, {
      "Cambio": P.title(c.title),
      "Versión": P.text(c.version ? `v${c.version}` : ""),
      "Fecha": P.date(c.date),
      "Serie": P.select(c.version ? `v${c.version.split(".").slice(0, 2).join(".")}` : "sin versión"),
      "Área": P.select(areaOf(c.files)),
      "Archivos": P.number(c.files.length),
      "Commit": P.text(c.hash),
    }, md);
    console.log("  +", c.hash, c.title);
  }
}

// ----------------------------------------------------------------------- run

const who = await api("/users/me");
if (who.status !== 200) {
  console.error("El token no sirve:", who.body?.message ?? who.status);
  process.exit(1);
}

await syncDecisions();
await syncChangelog();
console.log("Listo. Falta lo que no se puede automatizar: las páginas de prosa.");
