// Two steps: create the owner's account, then provision the organization. The second
// is provision.ts, not this page. A visitor who already has a session — from
// an interrupted sign-up — skips straight to the organization step.

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { authClient, PASSWORD_MIN, SHORT_PASSWORD, signUpMessage, UNREACHABLE } from '../auth';
import { provisionOrganization } from '../provision';
import { slugify, slugProblem, SLUG_MAX } from '../slug';
import Button from '../components/Button';
import Field from '../components/Field';
import Select from '../components/Select';
import shell from '../shell.module.css';
import styles from './Auth.module.css';
import Problem from '../components/Problem';


function browserZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function zoneOptions(current: string) {
  const zones = Intl.supportedValuesOf('timeZone');
  const all = zones.includes(current) ? zones : [current, ...zones];
  return all.map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }));
}


export default function SignUp() {
  const navigate = useNavigate();

  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [editedSlug, setEditedSlug] = useState<string | null>(null);
  const [timezone, setTimezone] = useState(browserZone);

  const session = authClient.useSession();
  const [accountMade, setAccountMade] = useState(false);
  const signedInAs = session.data?.user.email ?? (accountMade ? email : null);
  const hasAccount = signedInAs !== null;
  const [takenSlug, setTakenSlug] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);

  const slug = editedSlug ?? slugify(organizationName);
  const slugError = slugProblem(slug);
  const zones = useMemo(() => zoneOptions(browserZone()), []);

  const touched = organizationName.trim() !== '' || editedSlug !== null;
  // Shown only when something is wrong; the preview below says the rest.
  const slugHint =
    takenSlug === slug
      ? 'Another organization already has this address. Pick another.'
      : touched && slugError
        ? slugError
        : null;
  const showPreview = slug !== '' && !slugError && takenSlug !== slug;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;

    if (!organizationName.trim()) {
      setProblem('Enter the organization name.');
      return;
    }
    if (slugError) {
      setProblem('Fix the page address before continuing.');
      return;
    }
    if (!hasAccount && password.length < PASSWORD_MIN) {
      setProblem(SHORT_PASSWORD);
      return;
    }

    inFlight.current = true;
    setSending(true);
    setProblem(null);

    try {
      if (!hasAccount) {
        const { error } = await authClient.signUp.email({ name: ownerName, email, password });
        if (error) {
          setProblem(signUpMessage(error));
          return;
        }
        setAccountMade(true);
      }

      const result = await provisionOrganization({ name: organizationName.trim(), slug, timezone });
      if (result.ok) {
        navigate('/account');
      } else if (result.reason === 'slug_taken') {
        setTakenSlug(slug);
        setProblem('That page address is taken. Your account is saved; pick another address.');
      } else {
        setProblem(
          `Your account was created, but the organization was not.${result.detail ? ` ${result.detail}` : ''} Try again — only the organization step will repeat.`,
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
      <h1 className={shell.title}>Create an organization</h1>
      <p className={shell.lede}>
        This gives your organization its own booking page. Next you'll add hours, staff and services,
        and then it takes bookings. To see booking work first, <Link to="/">open a demo
        organization</Link>.
      </p>

      <form className={styles.form} onSubmit={submit}>
        {problem ? (
          <Problem role="alert">
            {problem}
          </Problem>
        ) : null}

        <div className={styles.group}>
          <h2 className={styles.groupTitle}>Your account</h2>
          {hasAccount ? (
            <p className={styles.note}>Signed in as {signedInAs}. Only the organization is left to set up.</p>
          ) : (
            <>
              <Field
                label="Your name"
                value={ownerName}
                onChange={setOwnerName}
                autoComplete="name"
                maxLength={200}
                required
              />
              <Field
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                maxLength={320}
                required
              />
              <Field
                label="Password"
                type="password"
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                maxLength={128}
                required
                hint={`At least ${PASSWORD_MIN} characters.`}
              />
            </>
          )}
        </div>

        <div className={styles.group}>
          <h2 className={styles.groupTitle}>Your organization</h2>
          <Field
            label="Organization name"
            value={organizationName}
            onChange={setOrganizationName}
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
            {...(slugHint ? { hint: slugHint } : {})}
          />
          {showPreview ? (
            <div className={styles.address}>
              <span className={styles.addressLabel}>Customers will book at</span>
              <span className={styles.addressValue}>{`${window.location.host}/${slug}`}</span>
            </div>
          ) : null}
          <Select label="Time zone" value={timezone} options={zones} onChange={setTimezone} />
        </div>

        <div className={styles.actions}>
          <Button type="submit" disabled={sending}>
            {sending ? 'Creating…' : hasAccount ? 'Create organization' : 'Create account and organization'}
          </Button>
        </div>
      </form>

      <p className={styles.switch}>
        Already have an account? <Link to="/signin">Sign in</Link>
      </p>
    </main>
  );
}
