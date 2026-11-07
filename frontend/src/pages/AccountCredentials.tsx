// Changing your own email and password, from the Account tab. Both go straight
// to Better Auth and both ask for the current password.

import { useState, type FormEvent, type ReactNode } from 'react';

import { PASSWORD_MIN, SHORT_PASSWORD, UNREACHABLE, authClient, authMessage, type AuthError } from '../auth';
import Button from '../components/Button';
import Field from '../components/Field';
import Problem from '../components/Problem';
import styles from './Auth.module.css';

function wrongPassword(error: AuthError, fallback: (e: AuthError) => string): string {
  return error.code === 'INVALID_PASSWORD' ? 'That password is not right.' : fallback(error);
}

export function ChangeEmail({ current }: { current: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    setDone(null);
    try {
      // Better Auth's schema has no password; our hook reads it from the body.
      const { error } = await authClient.changeEmail({ newEmail, password } as { newEmail: string });
      if (error) {
        setProblem(
          wrongPassword(error, (e) =>
            e.message === 'Email is the same'
              ? "That's already your email."
              : e.code === 'INVALID_EMAIL' || e.status === 400
                ? 'That email address does not look right.'
                : authMessage(e),
          ),
        );
        return;
      }
      // The answer is the same whether or not the address was free, so ask.
      const { data } = await authClient.getSession({ query: { disableCookieCache: true } });
      const now = data?.user.email;
      setPassword('');
      if (now && now === newEmail.trim().toLowerCase()) {
        setDone(`Your email is now ${now}. Sign in with it from now on.`);
        setNewEmail('');
        setOpen(false);
      } else {
        setProblem("Your email didn't change. That address may already belong to another account.");
      }
    } catch {
      setProblem(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.setting}>
      <h2 className={styles.subheading}>Email</h2>
      {done ? (
        <p className={styles.note} role="status">
          {done}
        </p>
      ) : null}
      {open ? (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          {problem ? <Problem role="alert">{problem}</Problem> : null}
          <Field label="New email" type="email" value={newEmail} onChange={setNewEmail} autoComplete="email" disabled={busy} required hint={`Now ${current}`} />
          <Field label="Your password, to confirm" type="password" value={password} onChange={setPassword} autoComplete="current-password" disabled={busy} required />
          <div className={styles.actions}>
            <Button type="submit" disabled={busy || !newEmail || !password}>
              {busy ? 'Changing…' : 'Change email'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Change email…
          </Button>
        </div>
      )}
    </section>
  );
}

export function ChangePassword(): ReactNode {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < PASSWORD_MIN) {
      setProblem(SHORT_PASSWORD);
      return;
    }
    setBusy(true);
    setProblem(null);
    setDone(false);
    try {
      // Other sessions end: a changed password is often a suspected leak.
      const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (error) {
        setProblem(wrongPassword(error, (e) => (e.code === 'PASSWORD_TOO_SHORT' ? SHORT_PASSWORD : authMessage(e))));
        return;
      }
      setCurrent('');
      setNew('');
      setOpen(false);
      setDone(true);
    } catch {
      setProblem(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.setting}>
      <h2 className={styles.subheading}>Password</h2>
      {done ? (
        <p className={styles.note} role="status">
          Password changed. Every other device you were signed in on is signed out.
        </p>
      ) : null}
      {open ? (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          {problem ? <Problem role="alert">{problem}</Problem> : null}
          <Field label="Current password" type="password" value={currentPassword} onChange={setCurrent} autoComplete="current-password" disabled={busy} required />
          <Field
            label="New password"
            type="password"
            value={newPassword}
            onChange={setNew}
            autoComplete="new-password"
            disabled={busy}
            required
            hint={`At least ${PASSWORD_MIN} characters. Signs you out on your other devices.`}
          />
          <div className={styles.actions}>
            <Button type="submit" disabled={busy || !currentPassword || !newPassword}>
              {busy ? 'Changing…' : 'Change password'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Change password…
          </Button>
        </div>
      )}
    </section>
  );
}
