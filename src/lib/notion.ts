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

/** Find the database's title property, whatever it happens to be called. */
async function titlePropertyName(dbId: string, token: string): Promise<string> {
  const res = await fetch(`${API}/databases/${dbId}`, {
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": VERSION },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message || `Notion database unreadable (${res.status})`);
  }
  const db = await res.json() as { properties?: Record<string, { type?: string }> };
  for (const [name, prop] of Object.entries(db.properties ?? {})) {
    if (prop?.type === "title") return name;
  }
  // Every Notion database has one; if we're here the id points at something
  // else (a page, say), and saying so beats a confusing property error.
  throw new Error("That Notion database has no title property — check the ID points at a database.");
}

export interface NotionResult { ok: boolean; url?: string; error?: string }

/** Create one page in the configured database. */
export async function createNotionPage(title: string, lines: string[]): Promise<NotionResult> {
  const token = process.env.NOTION_TOKEN;
  const dbId = process.env.NOTION_DATABASE_ID;
  if (!token || !dbId) return { ok: false, error: "Notion not configured" };

  try {
    const titleProp = await titlePropertyName(dbId, token);
    const res = await fetch(`${API}/pages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent: { database_id: dbId },
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
