// The bar on every page: the Whiteboard wordmark on the left, always linking
// home, and on the right a profile menu once someone is signed in. Mounted once
// in main.tsx, above the routes, so it never moves between pages.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { authClient, useSettledSession } from '../auth';
import PersonIcon from './PersonIcon';
import styles from './TopBar.module.css';

export default function TopBar(): ReactNode {
  const session = useSettledSession();
  const user = session.data?.user;
  const { pathname } = useLocation();

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Link className={styles.brand} to="/">
          Whiteboard
        </Link>
        {/* Nothing until the session is known, so "Sign in" never flashes for a signed-in owner. */}
        <nav className={styles.links} aria-label="Account">
          {session.isPending ? null : user ? (
            <ProfileMenu email={user.email} />
          ) : pathname === '/' ? (
            <>
              <Link to="/signin">Sign in</Link>
              <Link to="/signup">Don't have an account?</Link>
            </>
          ) : null}
        </nav>
      </div>
    </header>
  );
}

/** A disclosure, not an ARIA menu: two plain links/buttons revealed by one button. */
function ProfileMenu({ email }: { email: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // A page change closes it.
  useEffect(() => setOpen(false), [pathname]);

  // A click outside or Escape closes it; Escape hands focus back to the button.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function signOut() {
    setFailed(false);
    try {
      const { error } = await authClient.signOut();
      if (error) return setFailed(true);
      setOpen(false);
      navigate('/');
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className={styles.profile} ref={root}>
      <button
        ref={button}
        type="button"
        className={styles.icon}
        aria-label="Account menu"
        title="Account menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
      >
        <PersonIcon />
      </button>
      {open ? (
        <div className={styles.menu} id={menuId}>
          <p className={styles.email}>Signed in as {email}</p>
          <Link className={styles.item} to="/account">
            Your account
          </Link>
          <button type="button" className={styles.item} onClick={() => void signOut()}>
            Sign out
          </button>
          {failed ? (
            <p className={styles.problem} role="alert">
              Couldn't sign out. Try again.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
