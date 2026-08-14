import { createSign } from "node:crypto";

// ============================================================
// Firebase Cloud Messaging — SERVER ONLY.
//
// This is the only way to reach a phone nobody is looking at. Android suspends
// the app's JavaScript the moment the driver switches away, so anything the
// web app tries to do itself arrives when they come back — which is exactly
// when they no longer need it. FCM is delivered by the operating system
// instead, so it lands with the app backgrounded, closed, or the screen off.
//
// Auth is the OAuth2 service-account flow: sign a JWT with the account's
// private key, trade it for an access token, then call the v1 send endpoint.
// Done by hand rather than pulling in firebase-admin, which drags a large
// dependency tree into a serverless function for one HTTP call.
//
// The whole thing is inert without FIREBASE_SERVICE_ACCOUNT. That is
// deliberate: no key, no push, no crash — the in-app bell keeps working and
// nothing else in the app notices.
// ============================================================

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/**
 * Read the service account out of the environment.
 *
 * Returns null rather than throwing when it's absent or malformed: a missing
 * key means "push isn't set up yet", which is a normal state, not an error.
 * Private keys pasted into a dashboard usually arrive with literal `\n`
 * sequences instead of newlines, and that has to be undone or the signature
 * silently fails.
 */
export function parseServiceAccount(raw: string | null | undefined): ServiceAccount | null {
  if (!raw || !raw.trim()) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const project_id = typeof o.project_id === "string" ? o.project_id : "";
  const client_email = typeof o.client_email === "string" ? o.client_email : "";
  const key = typeof o.private_key === "string" ? o.private_key : "";
  if (!project_id || !client_email || !key) return null;
  return { project_id, client_email, private_key: key.replace(/\\n/g, "\n") };
}

/** Is push configured at all? */
export function fcmConfigured(): boolean {
  return parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT) !== null;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Signed JWT asserting "I am this service account, let me send messages". */
export function buildAssertion(sa: ServiceAccount, now = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;
}

// Access tokens last an hour; a warm instance reuses one rather than paying for
// a round trip per notification. Refreshed a minute early so an in-flight send
// can't be the one that discovers it expired.
let cached: { token: string; expires: number } | null = null;

async function accessToken(sa: ServiceAccount): Promise<string> {
  if (cached && Date.now() < cached.expires) return cached.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: buildAssertion(sa),
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `FCM auth failed (${res.status})`);
  }
  cached = { token: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000 };
  return cached.token;
}

/**
 * FCM's answer for one token, reduced to the only question that matters:
 * should this token be thrown away?
 *
 * UNREGISTERED / INVALID_ARGUMENT mean the app was uninstalled or the token was
 * replaced — keeping it means pushing into the void forever. Anything else
 * (rate limits, a Google outage) is temporary and the token stays.
 */
export function isDeadToken(status: number, body: unknown): boolean {
  if (status === 404) return true;
  const err = (body as { error?: { details?: Array<{ errorCode?: string }>; status?: string } })?.error;
  if (err?.status === "NOT_FOUND") return true;
  const code = err?.details?.find((d) => d.errorCode)?.errorCode;
  return code === "UNREGISTERED" || code === "INVALID_ARGUMENT";
}

export interface PushResult { sent: number; dead: string[]; error?: string }

/** Send one notification to a set of device tokens. */
export async function sendPush(
  tokens: string[],
  msg: { title: string; body: string; data?: Record<string, string> },
): Promise<PushResult> {
  const sa = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (!sa) return { sent: 0, dead: [], error: "push not configured" };
  if (!tokens.length) return { sent: 0, dead: [] };

  let auth: string;
  try {
    auth = await accessToken(sa);
  } catch (e) {
    return { sent: 0, dead: [], error: e instanceof Error ? e.message : "FCM auth failed" };
  }

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const dead: string[] = [];
  let sent = 0;

  // One request per token. The batch endpoint was retired, and a driver has
  // one or two phones — this is not the loop worth optimising.
  await Promise.all(tokens.map(async (token) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: msg.title, body: msg.body },
            data: msg.data,
            android: {
              // High priority so Doze delivers it immediately. A dispatch
              // assignment the driver reads two hours late is not an
              // assignment, it is a complaint.
              priority: "HIGH",
              notification: { channel_id: "assignments", default_sound: true },
            },
          },
        }),
      });
      if (res.ok) { sent++; return; }
      const body = await res.json().catch(() => null);
      if (isDeadToken(res.status, body)) dead.push(token);
    } catch {
      // Network trouble reaching Google: not the token's fault, keep it.
    }
  }));

  return { sent, dead };
}
