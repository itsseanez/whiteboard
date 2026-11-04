// Where sign-in lands: a placeholder for owner pages that do not exist yet. It
// lists the organizations this account belongs to and says plainly what is missing.

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
  | { kind: 'ready'; organizations: Membership[] };

export default function Account() {
  const navigate = useNavigate();
  const session = authClient.useSession();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getMyOrganizations()
      .then((organizations) => {
        if (live) setState({ kind: 'ready', organizations });
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
    const failed = 'Could not sign out, so you are still signed in. Try again in a moment.';
    try {
      const { error } = await authClient.signOut();
      if (error) setProblem(failed);
      else navigate('/');
    } catch {
      setProblem(failed);
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
          <Link to="/signin">Sign in</Link> to see your organization.
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
        {email ? `Signed in as ${email}. ` : ''}Set up hours, staff, resources and services, and see
        the calendar, for each organization you own.
      </p>

      {state.organizations.length === 0 ? (
        <p className={styles.note}>
          This account is not linked to an organization. If you just signed up, setting up the organization did
          not finish. <Link to="/signup">Finish setting up your organization</Link>.
        </p>
      ) : (
        <>
          <ul className={styles.list}>
            {state.organizations.map((organization) => (
              <li key={organization.tenantId}>
                <Link to={`/${organization.slug}`}>{`${window.location.host}/${organization.slug}`}</Link>
                <span className={styles.meta}>
                  Times in {organization.timezone}
                  {organization.role === 'owner' ? (
                    <>
                      {' · '}
                      <Link to={`/manage/${organization.slug}`}>Set up</Link>
                      {' · '}
                      <Link to={`/manage/${organization.slug}/calendar`}>Calendar</Link>
                    </>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            A new organization's page has nothing to book until it has staff, services and hours.
          </p>
        </>
      )}

      {problem ? (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </>,
  );
}
