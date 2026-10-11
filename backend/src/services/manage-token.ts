// The credential that lets a customer cancel or reschedule from an email link.
//
// Generated here, returned to the customer exactly once, and never stored. The
// appointment row keeps only sha256(token), so the database cannot leak a
// working token even to a reader with full SELECT on the table. See the
// reasoning in the appointment-manage-token migration.

import { createHash, randomBytes } from 'node:crypto';

/**
 * 32 bytes from the platform CSPRNG, base64url-encoded to 43 characters.
 *
 * base64url rather than hex so the token is half the length in a URL, and
 * rather than plain base64 so it needs no percent-encoding — `+`, `/` and `=`
 * all survive a round trip through a query string or an email client
 * differently depending on who rewrites the link.
 *
 * 256 bits is far beyond what guessing could reach, which is what lets the
 * token stand alone as authorization with no account behind it.
 */
export function issueManageToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashManageToken(token) };
}

/**
 * Lowercase hex, 64 characters, matching the CHECK on the column.
 *
 * No salt and no key-stretching, deliberately — both exist to defend
 * low-entropy secrets against offline guessing, and a 256-bit random token has
 * nothing to guess. A per-row salt would also break the unique index this is
 * looked up through. Comparison is likewise not timing-safe, and does not need
 * to be: Postgres compares the hash, not the secret, and an attacker who can
 * measure that has learned something about a digest they could have computed
 * themselves.
 */
export function hashManageToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
