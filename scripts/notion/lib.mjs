// Minimal Notion client for the living documentation.
//
// The token is NEVER in the repo. Pass it in the environment:
//   NOTION_TOKEN=ntn_... node scripts/notion/sync.mjs
// It is the same token used by /api/notion-summary, stored in Vercel.

const TOKEN = process.env.NOTION_TOKEN;
if (!TOKEN) {
  console.error("Falta NOTION_TOKEN. Ejemplo: NOTION_TOKEN=ntn_... node scripts/notion/sync.mjs");
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

// Notion allows about 3 requests a second. Everything goes through one throttle
// so a long import doesn't get rate-limited halfway and leave the docs in a
// half-written state.
let last = 0;
async function throttle() {
  const wait = 380 - (Date.now() - last);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

export async function api(path, init, tries = 4) {
  for (let n = 0; n < tries; n++) {
    await throttle();
    const res = await fetch(`https://api.notion.com/v1${path}`, { ...init, headers: HEADERS });
    const body = await res.json().catch(() => ({}));
    if (res.status !== 429 && res.status < 500) return { status: res.status, body };
    await new Promise((r) => setTimeout(r, 1200 * (n + 1)));
  }
  return { status: 0, body: { message: "se agotaron los reintentos" } };
}

const LIMIT = 1900; // Notion rejects a rich_text run over 2000 characters.

/** Split **bold** and `code` into Notion rich_text runs. */
export function rich(text) {
  const out = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastEnd = 0;
  let m;
  const push = (content, annotations) => {
    if (!content) return;
    for (let i = 0; i < content.length; i += LIMIT) {
      out.push({ type: "text", text: { content: content.slice(i, i + LIMIT) }, annotations });
    }
  };
  while ((m = re.exec(text))) {
    push(text.slice(lastEnd, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) push(tok.slice(2, -2), { bold: true });
    else push(tok.slice(1, -1), { code: true });
    lastEnd = m.index + tok.length;
  }
  push(text.slice(lastEnd));
  return out.length ? out : [{ type: "text", text: { content: "" } }];
}

const block = (type, extra) => ({ object: "block", type, [type]: extra });

/** Markdown-ish -> Notion blocks. Only the subset the docs actually use. */
export function toBlocks(md) {
  const out = [];
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // A pipe table becomes a real Notion table. Without this it lands as
    // paragraphs full of | characters, which is worse than no table at all.
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const rows = [cells(line)];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      const width = Math.max(...rows.map((r) => r.length));
      out.push(block("table", {
        table_width: width,
        has_column_header: true,
        has_row_header: false,
        children: rows.map((r) => block("table_row", {
          cells: Array.from({ length: width }, (_, c) => rich(r[c] ?? "")),
        })),
      }));
      continue;
    }

    if (line.startsWith("```")) {
      const language = line.slice(3).trim() || "plain text";
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(block("code", { language, rich_text: rich(buf.join("\n").slice(0, LIMIT)) }));
      continue;
    }

    if (line.startsWith("### ")) out.push(block("heading_3", { rich_text: rich(line.slice(4)) }));
    else if (line.startsWith("## ")) out.push(block("heading_2", { rich_text: rich(line.slice(3)) }));
    else if (line.startsWith("# ")) out.push(block("heading_1", { rich_text: rich(line.slice(2)) }));
    else if (line.startsWith("> ")) out.push(block("callout", { rich_text: rich(line.slice(2)), icon: { emoji: "💡" } }));
    else if (line.trim() === "---") out.push(block("divider", {}));
    else if (/^\s*[-*] /.test(line)) out.push(block("bulleted_list_item", { rich_text: rich(line.replace(/^\s*[-*] /, "")) }));
    else if (/^\s*\d+\. /.test(line)) out.push(block("numbered_list_item", { rich_text: rich(line.replace(/^\s*\d+\. /, "")) }));
    else out.push(block("paragraph", { rich_text: line.trim() ? rich(line) : [] }));
    i++;
  }
  return out;
}

export async function createRow(databaseId, properties, md) {
  const res = await api("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties,
      children: md ? toBlocks(md).slice(0, 100) : [],
    }),
  });
  if (res.status !== 200) throw new Error(res.body?.message ?? String(res.status));
  return res.body.id;
}

/** Every row of a database, following pagination. */
export async function allRows(databaseId) {
  const rows = [];
  let cursor;
  do {
    const res = await api(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
    });
    if (res.status !== 200) throw new Error(res.body?.message ?? String(res.status));
    rows.push(...res.body.results);
    cursor = res.body.has_more ? res.body.next_cursor : null;
  } while (cursor);
  return rows;
}

export const P = {
  title: (v) => ({ title: [{ type: "text", text: { content: (v || "—").slice(0, 1900) } }] }),
  text: (v) => ({ rich_text: v ? rich(String(v).slice(0, 1900)) : [] }),
  date: (v) => (v ? { date: { start: v } } : { date: null }),
  select: (v) => (v ? { select: { name: String(v).slice(0, 90) } } : { select: null }),
  number: (v) => ({ number: v ?? null }),
};
