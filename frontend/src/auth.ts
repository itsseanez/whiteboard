// The Better Auth client. Separate from api.ts on purpose: api.ts throws
// ApiError, this client RETURNS { data, error } for HTTP failures. It is not
// wrapped to match, so its own error codes reach the pages intact. It does
// throw when no response arrives at all — callers catch that.

import { useRef } from 'react';
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

export const PASSWORD_MIN = 8; // Better Auth's default minPasswordLength
export const SHORT_PASSWORD = `Use at least ${PASSWORD_MIN} characters for the password.`;

export function signUpMessage(error: AuthError): string {
  switch (error.code) {
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'An account with this email already exists. Sign in instead.';
    case 'INVALID_EMAIL':
      return 'That email address does not look right.';
    case 'PASSWORD_TOO_SHORT':
      return SHORT_PASSWORD;
    case 'PASSWORD_TOO_LONG':
      return 'That password is too long.';
    default:
      return authMessage(error);
  }
}

/**
 * useSession, but pending only until the first answer. Better Auth sets
 * isPending back to true on every refetch (on window focus, say) while no one
 * is signed in, so a page that hides its form while pending would unmount it
 * mid-typing. This keeps showing the last answer during a refetch instead.
 */
export function useSettledSession() {
  const session = authClient.useSession();
  const settled = useRef(false);
  if (!session.isPending) settled.current = true;
  return { data: session.data, isPending: !settled.current };
}
