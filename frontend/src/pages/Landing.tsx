// The product page, built as the design system's marketing tiles. Booking
// happens in one place, the live tile at the top; the rail at the bottom links
// each demo organization's full booking page. It exists only because this is a demo
// of a multi-tenant app.
//
// The demo organizations are literals, not fetched: there is deliberately no
// endpoint that lists tenants.

import { useRef, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';

import { authClient } from '../auth';
import PersonIcon from '../components/PersonIcon';
import LiveBooking from './landing/LiveBooking';
import { useReveal } from './landing/useReveal';
import shell from '../shell.module.css';
import styles from './Landing.module.css';

/** Stagger index for a tile's revealed children (80ms apart). */
const at = (i: number) => ({ '--i': i }) as CSSProperties;

export default function Landing() {
  const page = useRef<HTMLElement>(null);
  useReveal(page);

  return (
    <main ref={page} className={shell.page}>
      <TopBar />

      <div className={styles.tiles}>
        <LiveBooking />

        <div className={styles.halves}>
          <section className={`${styles.tile} ${styles.paper}`}>
            <h2 className={styles.tileTitle} data-reveal style={at(0)}>
              Can't be double-booked
            </h2>
            <p className={styles.tileLine} data-reveal style={at(1)}>
              Two people book the same time at once: one gets it, the other is told straight away.
            </p>
            <div className={styles.mock} aria-hidden="true">
              <span className={styles.mockSlot}>10:30 AM</span>
              <p className={styles.mockProblem}>
                Someone else just took that time. The times shown are now up to date.
              </p>
            </div>
          </section>

          <section className={`${styles.tile} ${styles.sunk}`}>
            <h2 className={styles.tileTitle} data-reveal style={at(0)}>
              Clients move or cancel
            </h2>
            <p className={styles.tileLine} data-reveal style={at(1)}>
              Every booking comes with a private link to change it, so a no-show can become
              someone else's appointment.
            </p>
            <div className={styles.mock} aria-hidden="true">
              <span className={styles.mockHeading}>Your appointment</span>
              <span className={styles.mockButtons}>
                <span className={styles.mockPrimary}>Move it</span>
                <span className={styles.mockSecondary}>Cancel it</span>
              </span>
            </div>
          </section>

          <section className={`${styles.tile} ${styles.sunk}`}>
            <h2 className={styles.tileTitle} data-reveal style={at(0)}>
              Right when the clocks change
            </h2>
            <p className={styles.tileLine} data-reveal style={at(1)}>
              Hours are kept in the organization's own time, so 9:00 is still 9:00 the morning after the
              clocks go back.
            </p>
            <div className={styles.mock} aria-hidden="true">
              <span className={styles.mockRow}>
                <span>Saturday 24 October</span>
                <span className={styles.mockTime}>Opens 9:00</span>
              </span>
              <span className={styles.mockRow}>
                <span>Monday 26 October</span>
                <span className={styles.mockTime}>Opens 9:00</span>
              </span>
            </div>
          </section>

          <section className={`${styles.tile} ${styles.paper}`}>
            <h2 className={styles.tileTitle} data-reveal style={at(0)}>
              Why it's called Whiteboard
            </h2>
            <p className={styles.tileLine} data-reveal style={at(1)}>
              A salon in Austria took my booking on a whiteboard on the wall. Good enough for the shop but
              for me, it meant leaving my hotel room just to schedule, cancel, or change my appointment. So
              I created Whiteboard to help businesses everywhere.
            </p>
          </section>
        </div>

        <section className={styles.railTile} aria-labelledby="rail-title">
          <h2 id="rail-title" className={styles.tileTitle} data-reveal style={at(0)}>
            Open an organization's full booking page
          </h2>
          <ul className={styles.rail} aria-label="Demo organizations">
            <li>
              <Link className={`${styles.railItem} ${styles.sunk}`} to="/studio-wien">
                <span className={styles.railName}>Studio Wien</span>
                <span className={styles.railMeta}>Vienna</span>
              </Link>
            </li>
            <li>
              <Link className={`${styles.railItem} ${styles.paperEdge}`} to="/signup">
                <span className={styles.railName}>Your organization</span>
                <span className={styles.railMeta}>Starts empty while owner tools are built</span>
              </Link>
            </li>
            <li>
              <Link className={`${styles.railItem} ${styles.sunk}`} to="/marinas-cuts-color">
                <span className={styles.railName}>Marina's Cuts & Color</span>
                <span className={styles.railMeta}>New York</span>
              </Link>
            </li>
          </ul>
        </section>
      </div>

      <footer className={styles.footer}>
        <a href="https://github.com/itsseanez/whiteboard">Source on GitHub</a>
      </footer>
    </main>
  );
}

/** Who is signed in, if anyone. Nothing shows until the session is known, so a
 * signed-in owner never sees "Sign in" flash first. */
function TopBar() {
  const session = authClient.useSession();
  const user = session.data?.user;

  return (
    <header className={styles.nav}>
      {user ? (
        <Link className={styles.brand} to="/account">
          Whiteboard
        </Link>
      ) : (
        <span className={styles.brand}>Whiteboard</span>
      )}
      <nav className={styles.navLinks} aria-label="Account">
        {session.isPending ? null : user ? (
          <>
            <span className={styles.signedIn}>Signed in as {user.email}</span>
            <Link className={styles.account} to="/account" aria-label="Your account" title="Your account">
              <PersonIcon />
            </Link>
          </>
        ) : (
          <>
            <Link to="/signin">Sign in</Link>
            <Link to="/signup">Don't have an account?</Link>
          </>
        )}
      </nav>
    </header>
  );
}
