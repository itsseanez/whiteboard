// Two steps: create the owner's account, then provision the salon. The second
// is provision.ts, not this page. If it fails the account stays signed in and
// a retry repeats only the salon step.

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { authClient, authMessage, UNREACHABLE, type AuthError } from '../auth';
import { provisionSalon } from '../provision';
import { slugify, slugProblem, SLUG_MAX } from '../slug';
import Button from '../components/Button';
import Field from '../components/Field';
import Select from '../components/Select';
import shell from '../shell.module.css';
import styles from './Auth.module.css';

const PASSWORD_MIN = 8; // Better Auth's default minPasswordLength
const SHORT_PASSWORD = `Use at least ${PASSWORD_MIN} characters for the password.`;

function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function zoneOptions(current: string) {
  const zones = Intl.supportedValuesOf('timeZone');
  const all = zones.includes(current) ? zones : [current, ...zones];
  return all.map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }));
}

function signUpMessage(error: AuthError): string {
  switch (error.code) {
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      return 'An account with this email already exists. Sign in instead.';
    case 'INVALID_EMAIL':
      return 'That email address does not look right.';
    case 'PASSWORD_TOO_SHORT':
      return SHORT_PASSWORD;
    case 'PASSWORD_TOO_LONG':
      return 'That password is too long.';
    default:
      return authMessage(error);
  }
}

export default function SignUp() {
  const navigate = useNavigate();

  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [salonName, setSalonName] = useState('');
  const [editedSlug, setEditedSlug] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(browserZone);

  const [accountMade, setAccountMade] = useState(false);
  const [takenSlug, setTakenSlug] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);

  const slug = editedSlug ?? slugify(salonName);
  const slugError = slugProblem(slug);
  const zones = useMemo(() => zoneOptions(browserZone()), []);

  const slugHint =
    takenSlug === slug
      ? 'Another salon already has this address. Pick another.'
      : slug && slugError
        ? slugError
        : `Your booking page: whiteboardhq.app/${slug || '…'}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;

    if (slugError) {
      setProblem('Fix the page address before continuing.');
      return;
    }
    if (!accountMade && password.length < PASSWORD_MIN) {
      setProblem(SHORT_PASSWORD);
      return;
    }

    inFlight.current = true;
    setSending(true);
    setProblem(null);

    try {
      if (!accountMade) {
        const { error } = await authClient.signUp.email({ name: ownerName, email, password });
        if (error) {
          setProblem(signUpMessage(error));
          return;
        }
        setAccountMade(true);
      }

      const result = await provisionSalon({ name: salonName.trim(), slug, timezone });
      if (result.ok) {
        navigate('/account');
      } else if (result.reason === 'slug_taken') {
        setTakenSlug(slug);
        setProblem('That page address is taken. Your account is saved; pick another address.');
      } else {
        setProblem(
          `Your account was created, but the salon was not.${result.detail ? ` ${result.detail}` : ''} Try again — only the salon step will repeat.`,
        );
      }
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
      <h1 className={shell.title}>Create a salon</h1>
      <p className={shell.lede}>
        This sets up an empty salon. Owner tools for adding staff, services and opening hours are
        not built yet, so it will have nothing to book. To see booking work, try one of the{' '}
        <Link to="/">demo salons</Link>.
      </p>

      <form className={styles.form} onSubmit={submit}>
        {problem ? (
          <p className={styles.problem} role="alert">
            {problem}
          </p>
        ) : null}

        <div className={styles.group}>
          <h2 className={styles.groupTitle}>You</h2>
          <Field
            label="Your name"
            value={ownerName}
            onChange={setOwnerName}
            autoComplete="name"
            maxLength={200}
            required
            disabled={accountMade}
          />
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            maxLength={320}
            required
            disabled={accountMade}
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            maxLength={128}
            required
            disabled={accountMade}
            hint={accountMade ? 'Account created.' : `At least ${PASSWORD_MIN} characters.`}
          />
        </div>

        <div className={styles.group}>
          <h2 className={styles.groupTitle}>Your salon</h2>
          <Field
            label="Salon name"
            value={salonName}
            onChange={setSalonName}
            autoComplete="organization"
            maxLength={200}
            required
          />
          <Field
            label="Page address"
            value={slug}
            onChange={(value) => setEditedSlug(value.toLowerCase())}
            autoComplete="off"
            maxLength={SLUG_MAX}
            required
            hint={slugHint}
          />
          <Select label="Time zone" value={timezone} options={zones} onChange={setTimezone} />
        </div>

        <div className={styles.actions}>
          <Button type="submit" disabled={sending}>
            {sending ? 'Creating…' : accountMade ? 'Create the salon' : 'Create account and salon'}
          </Button>
        </div>
      </form>

      <p className={styles.switch}>
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </main>
  );
}
