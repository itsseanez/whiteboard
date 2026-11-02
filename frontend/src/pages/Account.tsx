// Where sign-in lands: a placeholder for owner pages that do not exist yet. It
// lists the salons this account belongs to and says plainly what is missing.

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError, getMyOrganizations, type Membership } from '../api';
import { authClient } from '../auth';
import Button from '../components/Button';
import shell from '../shell.module.css';
import styles from './Auth.module.css';

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'failed' }
  | { kind: 'ready'; salons: Membership[] };

export default function Account() {
  const navigate = useNavigate();
  const session = authClient.useSession();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    getMyOrganizations()
      .then((salons) => {
        if (live) setState({ kind: 'ready', salons });
      })
      .catch((error: unknown) => {
        if (!live) return;
        const signedOut = error instanceof ApiError && error.status === 401;
        setState({ kind: signedOut ? 'signed-out' : 'failed' });
      });
    return () => {
      live = false;
    };
  }, []);

  async function signOut() {
    try {
      await authClient.signOut();
    } finally {
      navigate('/');
    }
  }

  const frame = (body: ReactNode) => (
    <main className={`${shell.page} ${shell.narrow}`}>
      <Link className={shell.wordmark} to="/">
        Whiteboard
      </Link>
      {body}
    </main>
  );

  if (state.kind === 'loading') return frame(<p className={shell.lede}>Loading…</p>);

  if (state.kind === 'signed-out') {
    return frame(
      <>
        <h1 className={shell.title}>Not signed in</h1>
        <p className={shell.lede}>
          <Link to="/signin">Sign in</Link> to see your salon.
        </p>
      </>,
    );
  }

  if (state.kind === 'failed') {
    return frame(
      <>
        <h1 className={shell.title}>Can't load your account</h1>
        <p className={shell.lede}>Something went wrong. Try again in a moment.</p>
      </>,
    );
  }

  const email = session.data?.user.email;

  return frame(
    <>
      <h1 className={shell.title}>Your account</h1>
      <p className={shell.lede}>
        {email ? `Signed in as ${email}. ` : ''}Owner tools — staff, services, opening hours,
        your calendar — are not built yet. This page is where they will live.
      </p>

      {state.salons.length === 0 ? (
        <p className={styles.note}>
          This account is not linked to a salon. If you just signed up, setting up the salon did
          not finish.
        </p>
      ) : (
        <>
          <ul className={styles.list}>
            {state.salons.map((salon) => (
              <li key={salon.tenantId}>
                <Link to={`/${salon.slug}`}>/{salon.slug}</Link>
                <span className={styles.meta}>
                  {salon.role} · {salon.timezone}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            A new salon's booking page has nothing to book until it has staff, services and hours.
          </p>
        </>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </>,
  );
}
