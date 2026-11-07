// Where sign-in lands, as tabs of like things: organizations you own or
// manage, organizations you work at as staff, and the account itself.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ApiError, getMyOrganizations, reopenOrganization, type Membership } from '../api';
import { authClient, UNREACHABLE } from '../auth';
import Button from '../components/Button';
import Field from '../components/Field';
import shell from '../shell.module.css';
import styles from './Auth.module.css';
import { ChangeEmail, ChangePassword, ConfirmEmail } from './AccountCredentials';
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
  // Where the confirmation link in the verification email lands.
  const [params] = useSearchParams();
  const justVerified = params.get('verified') === '1';
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [problem, setProblem] = useState<string | null>(null);

  const [reload, setReload] = useState(0);
  const [reopening, setReopening] = useState<string | null>(null);
  const [reopenProblem, setReopenProblem] = useState<string | null>(null);

  async function reopen(slug: string) {
    setReopening(slug);
    setReopenProblem(null);
    try {
      await reopenOrganization(slug);
      setReload((n) => n + 1);
    } catch {
      setReopenProblem("Couldn't reopen it. It may be past the 30 days. Try again in a moment.");
    } finally {
      setReopening(null);
    }
  }

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
  }, [reload]);

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
  const open = state.organizations.filter((o) => !o.closedAt);
  const closed = state.organizations.filter((o) => o.closedAt);
  const managed = open.filter((o) => o.role === 'owner' || o.role === 'admin');
  const staffed = open.filter((o) => o.role === 'member');
  const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

  const tabs: Tab[] = [];
  const queued: Tab[] = [];
  {
    const organizationsTab: Tab = {
      id: 'organizations',
      label: 'Organizations',
      panel: (
        <>
          {managed.length === 0 && closed.length === 0 ? (
          <p className={styles.note}>
            You don't run an organization yet. Create one to get your own booking page, or ask an owner to invite you.
          </p>
        ) : managed.length > 0 ? (
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
          ) : null}
          {closed.length > 0 ? (
            <>
              <h2 className={styles.subheading}>Closed</h2>
              {reopenProblem ? <Problem role="alert">{reopenProblem}</Problem> : null}
              <ul className={styles.list}>
                {closed.map((o) => (
                  <li key={o.tenantId}>
                    <span className={styles.name}>
                      {o.name}
                      <span className={styles.meta}>
                        {' '}
                        · closed {day(o.closedAt!)}. Reopen by {day(o.reopenUntil!)}, after which its address is
                        released.
                      </span>
                    </span>
                    <span className={styles.links}>
                      <Button variant="secondary" disabled={reopening !== null} onClick={() => void reopen(o.slug)}>
                        {reopening === o.slug ? 'Reopening…' : `Reopen ${o.name}`}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className={styles.newOrg}>
            <Link to="/signup">New organization</Link>
          </p>
        </>
      ),
    };
    // Someone who only works as staff opens on their week; everyone else on organizations.
    if (managed.length > 0 || closed.length > 0 || staffed.length === 0) tabs.push(organizationsTab);
    else queued.push(organizationsTab);
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
  tabs.push(...queued);
  tabs.push({
    id: 'account',
    label: 'Account',
    panel: (
      <>
        <dl className={styles.details}>
          <dt>Name</dt>
          <dd>{user?.name ?? '—'}</dd>
          <dt>Email</dt>
          <dd>
            {user?.email ?? '—'}
            {user && !user.emailVerified ? <span className={styles.unconfirmed}> · not confirmed</span> : null}
          </dd>
        </dl>
        {user && !user.emailVerified ? <ConfirmEmail email={user.email} /> : null}
        {problem ? <Problem role="alert">{problem}</Problem> : null}
        <div className={styles.actions}>
          <Button variant="secondary" onClick={signOut}>
            Sign out
          </Button>
        </div>
        {user ? <ChangeEmail current={user.email} verified={user.emailVerified} /> : null}
        <ChangePassword />
        <DeleteAccount />
      </>
    ),
  });

  return frame(
    <>
      <h1 className={shell.title}>Your account</h1>
      {justVerified ? (
        <p className={shell.lede} role="status">
          Your email is confirmed.
        </p>
      ) : null}
      <Tabs label="Your account" tabs={tabs} />
    </>,
  );
}

/** Deletes the signed-in account, with its password. Refused while it owns an open organization. */
function DeleteAccount(): ReactNode {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function remove(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const { error } = await authClient.deleteUser({ password });
      if (error) {
        setProblem(
          error.code === 'OWNS_ORGANIZATIONS'
            ? (error.message ?? 'Close the organizations you own first.')
            : error.code === 'INVALID_PASSWORD'
              ? 'That password is not right.'
              : "Couldn't delete your account. Try again in a moment.",
        );
        return;
      }
      navigate('/');
    } catch {
      setProblem(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.danger}>
      <h2 className={styles.subheading}>Delete account</h2>
      <p className={styles.note}>
        Deletes your sign-in and takes you out of every organization you belong to. If you're an organization's
        only owner, close it or make someone else an owner first. This can't be undone.
      </p>
      {open ? (
        <form className={styles.form} onSubmit={remove}>
          {problem ? <Problem role="alert">{problem}</Problem> : null}
          <Field
            label="Your password, to confirm"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={busy}
            required
          />
          <div className={styles.actions}>
            <Button type="submit" disabled={busy || !password}>
              {busy ? 'Deleting…' : 'Delete my account'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Keep it
            </Button>
          </div>
        </form>
      ) : (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Delete account…
          </Button>
        </div>
      )}
    </section>
  );
}
