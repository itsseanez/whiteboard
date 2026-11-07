// Accepting an invitation at /invite/:id. The email link carries ?email= so the
// sign-up form can be filled in; the server checks the address against the
// invitation either way. A staff member lands on their own week, a manager on setup.

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { acceptInvitation, ApiError } from '../api';
import { authClient, PASSWORD_MIN, SHORT_PASSWORD, signUpMessage, UNREACHABLE } from '../auth';
import Button from '../components/Button';
import Field from '../components/Field';
import Problem from '../components/Problem';
import shell from '../shell.module.css';
import styles from './Auth.module.css';

function acceptMessage(error: unknown, invitedEmail: string): string {
  if (!(error instanceof ApiError)) return UNREACHABLE;
  switch (error.code) {
    case 'wrong_account':
      return invitedEmail
        ? `This invitation is for ${invitedEmail}. Sign out, then sign in or create an account with that address.`
        : 'This invitation is for a different email address. Sign out and use the address it was sent to.';
    case 'invitation_expired':
      return 'This invitation has expired. Ask for a new one.';
    case 'invitation_closed':
    case 'invitation_not_found':
      return "This invitation can't be used any more. Ask for a new one.";
    case 'staff_unavailable':
      return "You've joined, but the staff profile this invitation was for has been removed or taken. Ask for a new invitation.";
    default:
      return 'Something went wrong. Try again in a moment.';
  }
}

export default function Invite() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const invitedEmail = params.get('email') ?? '';
  const navigate = useNavigate();
  const session = authClient.useSession();

  const [name, setName] = useState('');
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [wrongAccount, setWrongAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function accept() {
    try {
      const { slug, role } = await acceptInvitation(id);
      navigate(role === 'member' ? `/manage/${slug}/me` : `/manage/${slug}`);
    } catch (error) {
      setWrongAccount(error instanceof ApiError && error.code === 'wrong_account');
      setProblem(acceptMessage(error, invitedEmail));
    }
  }

  async function run(fn: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await fn();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function signUpAndAccept(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (password.length < PASSWORD_MIN) return setProblem(SHORT_PASSWORD);
      try {
        const { error } = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
        if (error) return setProblem(signUpMessage(error));
      } catch {
        return setProblem(UNREACHABLE);
      }
      await accept();
    });
  }

  function signOut() {
    void run(async () => {
      await authClient.signOut().catch(() => undefined);
      setWrongAccount(false);
      setProblem(null);
    });
  }

  const frame = (body: ReactNode) => (
    <main className={`${shell.page} ${shell.narrow}`}>
      <Link className={shell.wordmark} to="/">
        Whiteboard
      </Link>
      <h1 className={shell.title}>You're invited</h1>
      {body}
    </main>
  );

  const problemLine = problem ? <Problem role="alert">{problem}</Problem> : null;

  if (session.isPending) return frame(<p className={shell.lede}>Loading…</p>);

  const user = session.data?.user;
  if (user) {
    return frame(
      <>
        <p className={shell.lede}>Join the organization that invited you, signed in as {user.email}.</p>
        <div className={styles.form}>
          {problemLine}
          <div className={styles.actions}>
            {wrongAccount ? (
              <Button variant="secondary" disabled={busy} onClick={signOut}>
                Sign out
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void run(accept)}>
                {busy ? 'Joining…' : 'Accept invitation'}
              </Button>
            )}
          </div>
        </div>
      </>,
    );
  }

  return frame(
    <>
      <p className={shell.lede}>Create your account to join. Use the address the invitation was sent to.</p>
      <form className={styles.form} onSubmit={signUpAndAccept}>
        {problemLine}
        <Field label="Your name" value={name} onChange={setName} autoComplete="name" required />
        <Field label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" required />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={`At least ${PASSWORD_MIN} characters.`}
          required
        />
        <div className={styles.actions}>
          <Button type="submit" disabled={busy}>
            {busy ? 'Joining…' : 'Create account and join'}
          </Button>
        </div>
      </form>
      <p className={styles.switch}>
        Already have an account? <Link to={`/signin?next=${encodeURIComponent(`/invite/${id}`)}`}>Sign in</Link>, then
        come back to this link.
      </p>
    </>,
  );
}
