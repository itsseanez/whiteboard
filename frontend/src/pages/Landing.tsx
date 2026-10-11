// The root page exists only because this is a demo of a multi-tenant app: a
// real deployment would put each salon on its own domain or subdomain and
// nobody would ever see this.
//
// The two salons are the seed migration's demo tenants, named here as literals
// rather than fetched. There is deliberately no endpoint that lists tenants —
// "which businesses use this product" is not something a public API should
// answer, and adding one to make this page prettier would be a real leak in
// exchange for a demo convenience.

import { Link } from 'react-router-dom';

import shell from '../shell.module.css';
import styles from './Landing.module.css';

const DEMO_SALONS = [
  { slug: 'studio-wien', name: 'Studio Wien', zone: 'Vienna' },
  { slug: 'marinas-cuts-color', name: "Marina's Cuts & Color", zone: 'New York' },
];

export default function Landing() {
  return (
    <main className={`${shell.page} ${shell.narrow}`}>
      <span className={shell.wordmark}>Whiteboard</span>

      <h1 className={styles.headline}>
        Two salons, <span className={styles.quiet}>one engine</span>
      </h1>

      <p className={shell.lede}>
        Booking software for independent service businesses. Both salons below run the same code
        and the same database, and neither can see the other's day.
      </p>

      <ul className={styles.salons}>
        {DEMO_SALONS.map((salon) => (
          <li key={salon.slug}>
            <Link className={styles.salon} to={`/${salon.slug}`}>
              <span className={styles.name}>{salon.name}</span>
              <span className={styles.zone}>{salon.zone}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className={styles.note}>
        They sit in different time zones on purpose. Opening hours are stored as local wall clock
        times, so each salon's day is correct on the mornings the clocks change.
      </p>
    </main>
  );
}
