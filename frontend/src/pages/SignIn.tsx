import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { authClient, authMessage, UNREACHABLE } from '../auth';
import Button from '../components/Button';
import Field from '../components/Field';
import shell from '../shell.module.css';
import styles from './Auth.module.css';
import Problem from '../components/Problem';

/** Only a path on this site, so the link can't send someone elsewhere after signing in. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/account';
}

export default function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // A ref, not `sending`: two submits in one tick both read the old state.
  const inFlight = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setProblem(null);

    try {
      const { error } = await authClient.signIn.email({ email, password });
      if (error) {
        setProblem(authMessage(error));
        return;
      }
      navigate(safeNext(params.get('next')));
    } catch {
      setProblem(UNREACHABLE);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <main className={`${shell.page} ${shell.narrow}`}>
      <h1 className={shell.title}>Sign in</h1>
      <p className={shell.lede}>For owners, managers and staff. Customers book without an account.</p>

      <form className={styles.form} onSubmit={submit}>
        {problem ? (
          <Problem role="alert">
            {problem}
          </Problem>
        ) : null}
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
        />
        <div className={styles.actions}>
          <Button type="submit" disabled={sending}>
            {sending ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
      </form>

      <p className={styles.switch}>
        No account? <Link to="/signup">Create an organization</Link>
      </p>
    </main>
  );
}
