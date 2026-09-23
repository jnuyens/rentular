/**
 * Single source of truth for AUTH_SECRET, which underpins three security
 * primitives: the at-rest encryption key (encryption.ts), the OAuth state
 * signer (bankOAuthState.ts), and the session cookie decoder (authMiddleware).
 *
 * Historically these callers fell back to an empty string when AUTH_SECRET was
 * unset, only logging a warning. An empty secret means the encryption key
 * becomes sha256("") (a public constant) and state/session tokens become
 * forgeable. This helper fails CLOSED instead: it throws, so the process
 * cannot serve real banking data under a guessable key.
 */

const MIN_LENGTH = 16;

export function requireAuthSecret(): string {
  const secret = process.env.AUTH_SECRET || "";
  if (secret.length < MIN_LENGTH) {
    throw new Error(
      `AUTH_SECRET must be set and at least ${MIN_LENGTH} characters; refusing to start with a weak or empty secret.`
    );
  }
  return secret;
}
