// Forgotten passwords: /signin/forgot asks for the address, and the emailed
// link opens /signin/reset?token=…, which posts the token with the new
// password. The token sits in the URL only because an email link has nowhere
// else to put it; this page loads nothing from anyone else.

import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { PASSWORD_MIN, SHORT_PASSWORD, UNREACHABLE, authClient, authMessage } from '@/lib/auth';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import Problem from '@/components/ui/Problem';
import shell from '@/styles/shell.module.css';
import styles from './Auth.module.css';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setProblem(null);
    try {
      const { error } = await authClient.requestPasswordReset({ email, redirectTo: '/signin/reset' });
      if (error) {
        setProblem(authMessage(error));
        return;
      }
      setSentTo(email);
    } catch {
      setProblem(UNREACHABLE);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className={`${shell.page} ${shell.narrow}`}>
      <h1 className={shell.title}>Forgot your password?</h1>
      {sentTo ? (
        <p className={shell.lede} role="status">
          If there's an account for {sentTo}, we've emailed it a link to choose a new password. The link works for
          one hour.
        </p>
      ) : (
        <>
          <p className={shell.lede}>We'll email you a link to choose a new one.</p>
          <form className={styles.form} onSubmit={(event) => void submit(event)}>
            {problem ? <Problem role="alert">{problem}</Problem> : null}
            <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
            <div className={styles.actions}>
              <Button type="submit" disabled={sending || !email}>
                {sending ? 'Sending…' : 'Email me a link'}
              </Button>
            </div>
          </form>
        </>
      )}
      <p className={styles.switch}>
        <Link to="/signin">Back to sign in</Link>
      </p>
    </main>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(!token);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password.length < PASSWORD_MIN) {
      setProblem(SHORT_PASSWORD);
      return;
    }
    setSending(true);
    setProblem(null);
    try {
      const { error } = await authClient.resetPassword({ newPassword: password, token });
      if (error) {
        if (error.code === 'INVALID_TOKEN' || error.status === 400) setExpired(true);
        else setProblem(error.code === 'PASSWORD_TOO_SHORT' ? SHORT_PASSWORD : authMessage(error));
        return;
      }
      setDone(true);
    } catch {
      setProblem(UNREACHABLE);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className={`${shell.page} ${shell.narrow}`}>
      <h1 className={shell.title}>Choose a new password</h1>
      {done ? (
        <>
          <p className={shell.lede} role="status">
            Your password is changed, and you're signed out everywhere it was in use.
          </p>
          <p className={styles.switch}>
            <Link to="/signin">Sign in</Link>
          </p>
        </>
      ) : expired ? (
        <>
          <p className={shell.lede}>This link has expired or was already used. Links work once, for one hour.</p>
          <p className={styles.switch}>
            <Link to="/signin/forgot">Get a new link</Link>
          </p>
        </>
      ) : (
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          {problem ? <Problem role="alert">{problem}</Problem> : null}
          <Field
            label="New password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            hint={`At least ${PASSWORD_MIN} characters.`}
            required
          />
          <div className={styles.actions}>
            <Button type="submit" disabled={sending || !password}>
              {sending ? 'Saving…' : 'Save new password'}
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
