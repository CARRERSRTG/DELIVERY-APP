import { describe, it, expect } from "vitest";
import { buildAssertion, isDeadToken, parseServiceAccount } from "./fcm";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const sa = { project_id: "rdz-deliveries", client_email: "push@rdz.iam.gserviceaccount.com", private_key: privateKey };

describe("parseServiceAccount", () => {
  it("reads a well-formed key", () => {
    const p = parseServiceAccount(JSON.stringify(sa));
    expect(p?.project_id).toBe("rdz-deliveries");
    expect(p?.client_email).toBe("push@rdz.iam.gserviceaccount.com");
  });

  it("un-escapes newlines mangled by a dashboard paste", () => {
    // Vercel's env editor turns real newlines into literal \n. Left as-is the
    // signature fails silently, which is the worst possible failure mode.
    const mangled = JSON.stringify({ ...sa, private_key: "-----BEGIN-----\nabc\n-----END-----" });
    expect(parseServiceAccount(mangled)?.private_key).toBe("-----BEGIN-----\nabc\n-----END-----");
  });

  it("treats an absent key as 'not set up', not an error", () => {
    for (const v of [null, undefined, "", "   "]) expect(parseServiceAccount(v)).toBeNull();
  });

  it("returns null rather than throwing on junk", () => {
    expect(parseServiceAccount("not json")).toBeNull();
    expect(parseServiceAccount("[]")).toBeNull();
    expect(parseServiceAccount("null")).toBeNull();
  });

  it("rejects a key that is missing any required field", () => {
    expect(parseServiceAccount(JSON.stringify({ ...sa, project_id: "" }))).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ ...sa, client_email: undefined }))).toBeNull();
    expect(parseServiceAccount(JSON.stringify({ ...sa, private_key: "" }))).toBeNull();
  });
});

describe("buildAssertion", () => {
  it("signs a JWT Google will accept the shape of", () => {
    const jwt = buildAssertion(sa, 1_700_000_000);
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims.iss).toBe(sa.client_email);
    expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    expect(claims.exp - claims.iat).toBe(3600);
    expect(s.length).toBeGreaterThan(0);
  });

  it("produces url-safe base64 with no padding", () => {
    // A '+' or '/' in the JWT makes Google reject it, and the failure looks
    // like a bad key rather than bad encoding.
    expect(buildAssertion(sa, 1_700_000_000)).not.toMatch(/[+/=]/);
  });
});

describe("isDeadToken", () => {
  it("drops a token for an app that was uninstalled", () => {
    expect(isDeadToken(404, { error: { status: "NOT_FOUND" } })).toBe(true);
    expect(isDeadToken(400, { error: { details: [{ errorCode: "UNREGISTERED" }] } })).toBe(true);
    expect(isDeadToken(400, { error: { details: [{ errorCode: "INVALID_ARGUMENT" }] } })).toBe(true);
  });

  it("KEEPS a token through a temporary failure", () => {
    // Deleting on a rate limit or a Google outage would quietly unsubscribe
    // every driver, and nothing would ever tell us.
    expect(isDeadToken(429, { error: { details: [{ errorCode: "QUOTA_EXCEEDED" }] } })).toBe(false);
    expect(isDeadToken(503, { error: { status: "UNAVAILABLE" } })).toBe(false);
    expect(isDeadToken(500, null)).toBe(false);
  });
});
