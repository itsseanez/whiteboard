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

const DEMO_SALONS = [
  { slug: 'studio-wien', name: 'Studio Wien', zone: 'Vienna' },
  { slug: 'marinas-cuts-color', name: "Marina's Cuts & Color", zone: 'New York' },
];

export default function Landing() {
  return (
    <main className="page">
      <span className="wordmark">Whiteboard</span>

      <h1 className="date">
        <span>Two salons,</span>
        <span className="month">one engine</span>
      </h1>

      <p className="lede">
        Booking software for independent service businesses. Both salons below run the same
        code and the same database, and neither can see the other's day.
      </p>

      <ul className="salons">
        {DEMO_SALONS.map((salon) => (
          <li key={salon.slug}>
            <Link to={`/${salon.slug}`}>
              <span className="name">{salon.name}</span>
              <span className="zone">{salon.zone}</span>
            </Link>
          </li>
        ))}
      </ul>

      <p className="note">
        They sit in different time zones on purpose. Opening hours are stored as local wall
        clock times, so each salon's day is correct on the mornings the clocks change.
      </p>
    </main>
  );
}
