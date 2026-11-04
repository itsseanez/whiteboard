import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { authClient, authMessage, UNREACHABLE } from '../auth';
import Button from '../components/Button';
import Field from '../components/Field';
import shell from '../shell.module.css';
import styles from './Auth.module.css';

export default function SignIn() {
  const navigate = useNavigate();
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
      navigate('/account');
    } catch {
      setProblem(UNREACHABLE);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  return (
    <main className={`${shell.page} ${shell.narrow}`}>
      <Link className={shell.wordmark} to="/">
        Whiteboard
      </Link>
      <h1 className={shell.title}>Sign in</h1>
      <p className={shell.lede}>For organization owners. Customers book without an account.</p>

      <form className={styles.form} onSubmit={submit}>
        {problem ? (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
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
