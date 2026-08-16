// ============================================================
// Signing in with a username instead of an email.
//
// Supabase Auth identifies people by email, and that is not negotiable. So a
// user who has no email gets a SYNTHETIC one, derived from their username by a
// fixed rule.
//
// Deriving it — rather than looking it up — is the whole trick. The login
// screen can turn "maximo" into an address on its own, so there is no endpoint
// that answers "does this username exist?", and therefore nothing to probe for
// a list of who works here.
//
// THE COST, and it is real: a person with no email address cannot reset their
// own password. No link can reach them. An admin has to set a new one. Give a
// real email to anyone you don't want to be on the hook for.
// ============================================================

/** Where synthetic addresses live. Never receives mail; it only has to be a
 * valid, stable address that nobody else could claim. */
export const INTERNAL_EMAIL_DOMAIN = "users.rdztilegroup.net";

/**
 * Usernames are lowercase letters, digits, dot, dash and underscore.
 *
 * Deliberately narrow: the value becomes the local part of an email address,
 * and anything exotic there produces an account that looks fine and cannot log
 * in. Case is folded so "Maximo" and "maximo" can never be two people.
 */
export function normalizeUsername(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

export function isValidUsername(raw: string | null | undefined): boolean {
  const u = normalizeUsername(raw);
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u);
}

/** The address a username signs in with. */
export function emailForUsername(raw: string): string {
  return `${normalizeUsername(raw)}@${INTERNAL_EMAIL_DOMAIN}`;
}

/** Was this address invented for a username, rather than typed by a person? */
export function isSyntheticEmail(email: string | null | undefined): boolean {
  return (email ?? "").trim().toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);
}

/**
 * What the login screen should send to Supabase.
 *
 * Anything containing "@" is taken as an email and passed through untouched —
 * a real address must never be rewritten. Everything else is a username.
 */
export function loginEmail(input: string): string {
  const v = (input ?? "").trim();
  return v.includes("@") ? v.toLowerCase() : emailForUsername(v);
}
