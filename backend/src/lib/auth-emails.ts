// The two emails Better Auth asks us to send: a password reset and an address
// check. Both go to the outbox and are useful for an hour, as long as their
// tokens last. Queueing can't fail the request in a way that tells anyone
// whether the address has an account; if it throws, that's logged.

import { appUrl } from './mailer.js';
import { queueMail } from '../jobs/queue.js';

async function send(to: string, subject: string, text: string): Promise<void> {
  try {
    await queueMail({ to, subject, text }, { hours: 1 });
  } catch (err) {
    console.error(`Queueing "${subject}" for ${to} failed:`, err);
  }
}

/** Straight to our page, not through Better Auth's redirect; the page posts the token. */
export function resetLink(token: string): string {
  return appUrl(`/signin/reset?token=${encodeURIComponent(token)}`);
}

/** Better Auth's GET verifies the token, then sends the browser back to the account page. */
export function verifyLink(token: string): string {
  const back = appUrl('/account?verified=1');
  return appUrl(`/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent(back)}`);
}

export async function sendResetPassword({ user, token }: { user: { email: string }; token: string }): Promise<void> {
  await send(
    user.email,
    'Reset your Whiteboard password',
    `Someone asked to reset the password for this address on Whiteboard.\n\n` +
      `Choose a new password: ${resetLink(token)}\n\n` +
      `The link works for one hour, once. If it wasn't you, ignore this; your password stays as it is.`,
  );
}

export async function sendVerification({ user, token }: { user: { email: string }; token: string }): Promise<void> {
  await send(
    user.email,
    'Confirm your email for Whiteboard',
    `Confirm that this is your address: ${verifyLink(token)}\n\n` +
      `If you didn't sign up for Whiteboard or change your email to this one, ignore this.`,
  );
}
