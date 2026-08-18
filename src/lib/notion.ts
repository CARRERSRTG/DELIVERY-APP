// ============================================================
// Notion — SERVER ONLY.
//
// Writes one page per day into a database the owner shares with the
// integration. Deliberately does NOT require that database to have any
// particular columns: the title is the only property Notion guarantees exists,
// and everything else goes in the page BODY as text.
//
// That choice is the difference between "create a database and share it" and
// "create a database with exactly these seven properties spelled this way" —
// and a schema mismatch fails at 2am with a message nobody sees.
//
// Inert without NOTION_TOKEN / NOTION_DATABASE_ID: no token, no post, no
// crash.
// ============================================================

const API = "https://api.notion.com/v1";
// Notion requires an explicit API version; without it every call is rejected.
const VERSION = "2022-06-28";

export function notionConfigured(): boolean {
  return !!(process.env.NOTION_TOKEN && process.env.NOTION_DATABASE_ID);
}

/** Notion caps a text block at 2000 characters. */
const CHUNK = 1900;

/** Plain lines → paragraph blocks, splitting anything Notion would reject. */
export function toBlocks(lines: string[]): unknown[] {
  const out: unknown[] = [];
  for (const line of lines) {
    const parts = line.length <= CHUNK
      ? [line]
      : (line.match(new RegExp(`.{1,${CHUNK}}`, "g")) ?? [line]);
    for (const text of parts) {
      out.push({
        object: "block",
        type: "paragraph",
        // An empty line is a real paragraph with no text — that's how the
        // spacing in the report survives.
        paragraph: { rich_text: text ? [{ type: "text", text: { content: text } }] : [] },
      });
    }
  }
  // Notion accepts at most 100 blocks when creating a page.
  return out.slice(0, 100);
}

function head(id: string, token: string) {
  return { Authorization: `Bearer ${token}`, "Notion-Version": VERSION };
}

/** The title property of a database, whatever it happens to be called. */
function findTitleProp(db: { properties?: Record<string, { type?: string }> }): string | null {
  for (const [name, prop] of Object.entries(db.properties ?? {})) {
    if (prop?.type === "title") return name;
  }
  return null;
}

/**
 * Turn whatever id the owner pasted into a real database id.
 *
 * Notion's "Copy link" on a page gives a PAGE id, and a page that contains a
 * table looks identical in the URL to the table itself — the link is
 * `/p/Name-<id>` either way. Demanding the database id means the obvious
 * action produces "Could not find database" and no clue why.
 *
 * So: try it as a database; if that fails, treat it as a page and take the
 * first table inside it. One extra request on a once-a-day job, in exchange
 * for the setup step people actually get wrong.
 */
async function resolveDatabase(rawId: string, token: string): Promise<{ id: string; titleProp: string }> {
  const id = rawId.trim().replace(/-/g, "");

  const asDb = await fetch(`${API}/databases/${id}`, { headers: head(id, token) });
  if (asDb.ok) {
    const db = await asDb.json();
    const titleProp = findTitleProp(db);
    if (titleProp) return { id, titleProp };
  }

  const children = await fetch(`${API}/blocks/${id}/children?page_size=100`, { headers: head(id, token) });
  if (children.ok) {
    const body = await children.json() as { results?: { id: string; type?: string }[] };
    const table = (body.results ?? []).find((b) => b.type === "child_database");
    if (table) {
      const inner = await fetch(`${API}/databases/${table.id.replace(/-/g, "")}`, { headers: head(id, token) });
      if (inner.ok) {
        const db = await inner.json();
        const titleProp = findTitleProp(db);
        if (titleProp) return { id: table.id.replace(/-/g, ""), titleProp };
      }
    }
  }

  // Both readings failed. The first error is the useful one — it's usually
  // "Could not find database", which almost always means the connection was
  // never added to the page rather than a wrong id.
  const err = await asDb.json().catch(() => ({}));
  throw new Error(
    (err as { message?: string }).message
    || "Notion couldn't read that id as a database or as a page containing one.",
  );
}

export interface NotionResult { ok: boolean; url?: string; error?: string }

/** Create one page in the configured database. */
export async function createNotionPage(title: string, lines: string[]): Promise<NotionResult> {
  const token = process.env.NOTION_TOKEN;
  const dbId = process.env.NOTION_DATABASE_ID;
  if (!token || !dbId) return { ok: false, error: "Notion not configured" };

  try {
    const { id: resolvedId, titleProp } = await resolveDatabase(dbId, token);
    const res = await fetch(`${API}/pages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: resolvedId },
        properties: { [titleProp]: { title: [{ type: "text", text: { content: title } }] } },
        children: toBlocks(lines),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: (body as { message?: string }).message || `Notion refused the page (${res.status})` };
    }
    return { ok: true, url: (body as { url?: string }).url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Notion call failed" };
  }
}
