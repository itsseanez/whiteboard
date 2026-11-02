// The Better Auth client. Separate from api.ts on purpose: api.ts throws
// ApiError, this client RETURNS { data, error } for HTTP failures. It is not
// wrapped to match, so its own error codes reach the pages intact. It does
// throw when no response arrives at all — callers catch that.

import { createAuthClient } from 'better-auth/react';
import { organizationClient } from 'better-auth/client/plugins';

// No baseURL: defaults to this page's origin + /api/auth, which Express serves
// in production and Vite proxies in development.
export const authClient = createAuthClient({
  plugins: [organizationClient()],
});

/** The client's error for an HTTP failure. */
export interface AuthError {
  status: number;
  code?: string | undefined;
}

export function authMessage(error: AuthError): string {
  if (error.code === 'INVALID_EMAIL_OR_PASSWORD') return 'That email and password do not match.';
  if (error.status === 429) return 'Too many attempts. Wait a minute and try again.';
  // 404/405/5xx: the request never reached Better Auth, or it broke. Not the
  // user's doing, so not phrased as if it were.
  if (error.status === 404 || error.status === 405 || error.status >= 500) {
    return 'Sign-in is unavailable right now. Try again in a moment.';
  }
  return 'Something went wrong. Try again in a moment.';
}

export const UNREACHABLE = 'Could not reach Whiteboard. Check your connection and try again.';
