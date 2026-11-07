// Where sign-in lands, as tabs of like things: organizations you own or
// manage, organizations you work at as staff, and the account itself.

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError, getMyOrganizations, type Membership } from '../api';
import { authClient } from '../auth';
import Button from '../components/Button';
import shell from '../shell.module.css';
import styles from './Auth.module.css';
import Problem from '../components/Problem';
import Tabs, { type Tab } from '../components/Tabs';

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

  const user = session.data?.user;
  const managed = state.organizations.filter((o) => o.role === 'owner' || o.role === 'admin');
  const staffed = state.organizations.filter((o) => o.role === 'member');

  const tabs: Tab[] = [];
  if (managed.length > 0 || staffed.length === 0) {
    tabs.push({
      id: 'organizations',
      label: 'Organizations',
      panel:
        managed.length === 0 ? (
          <p className={styles.note}>
            This account is not linked to an organization. If you just signed up, setting up the organization did
            not finish. <Link to="/signup">Finish setting up your organization</Link>.
          </p>
        ) : (
          <ul className={styles.list}>
            {managed.map((o) => (
              <li key={o.tenantId}>
                <span className={styles.name}>
                  {o.name}
                  <span className={styles.meta}> · {o.role === 'owner' ? 'Owner' : 'Manager'}</span>
                </span>
                <span className={styles.links}>
                  <Link to={`/manage/${o.slug}`}>Edit</Link>
                  <Link to={`/${o.slug}`}>View</Link>
                </span>
              </li>
            ))}
          </ul>
        ),
    });
  }
  if (staffed.length > 0) {
    tabs.push({
      id: 'week',
      label: 'Your week',
      panel: (
        <ul className={styles.list}>
          {staffed.map((o) => (
            <li key={o.tenantId}>
              <span className={styles.name}>{o.name}</span>
              <span className={styles.links}>
                <Link to={`/manage/${o.slug}/me`}>Your week</Link>
              </span>
            </li>
          ))}
        </ul>
      ),
    });
  }
  tabs.push({
    id: 'account',
    label: 'Account',
    panel: (
      <>
        <dl className={styles.details}>
          <dt>Name</dt>
          <dd>{user?.name ?? '—'}</dd>
          <dt>Email</dt>
          <dd>{user?.email ?? '—'}</dd>
        </dl>
        {problem ? <Problem role="alert">{problem}</Problem> : null}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </>
    ),
  });

  return frame(
    <>
      <h1 className={shell.title}>Your account</h1>
      <Tabs label="Your account" tabs={tabs} />
    </>,
  );
}
