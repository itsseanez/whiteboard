// What happens to people's details, in plain words. Linked from the booking
// form and sign-up. Kept short and true to what the code does.

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import shell from '@/styles/shell.module.css';
import styles from './Privacy.module.css';

export default function Privacy(): ReactNode {
  return (
    <main className={`${shell.page} ${shell.narrow}`}>
      <h1 className={shell.title}>Privacy</h1>
      <p className={shell.lede}>
        Whiteboard is booking software. When you book with an organization here, that organization decides what
        happens to your details; Whiteboard keeps them for it.
      </p>

      <section className={styles.section}>
        <h2>If you book an appointment</h2>
        <ul>
          <li>We keep your name, email, phone if you give one, and your appointments.</li>
          <li>
            They're used to book and manage your appointments: a confirmation with a link to change or cancel, a
            reminder the day before, and a note when something changes. Nothing else, and no marketing from us.
          </li>
          <li>
            The organization you booked with sees them: its owners, managers and the person doing your appointment.
            No other organization can, and the database enforces that.
          </li>
          <li>
            An organization can choose to send its bookings, with your details, to another app it uses, such as a
            spreadsheet or customer list.
          </li>
          <li>
            To have your details erased, ask the organization you booked with. It can remove your name, email and
            phone from every appointment you had there.
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>If you have an account</h2>
        <ul>
          <li>We keep your name, email and a scrambled form of your password, never the password itself.</li>
          <li>
            A cookie keeps you signed in. It's the only cookie we set: no analytics, no advertising, no tracking.
          </li>
          <li>You can change your email or password, or delete your account, from your account page.</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>Where it lives</h2>
        <ul>
          <li>On Amazon Web Services in the United States (us-east-1), with nightly backups kept for 30 days.</li>
          <li>Emails are sent through Amazon's email service.</li>
          <li>Nothing is sold or shared with anyone else.</li>
        </ul>
      </section>

      <p className={styles.contact}>
        Questions about an appointment, or about your details, go to the organization you booked with.
      </p>
      <p className={styles.updated}>
        Last updated 7 November 2026. <Link to="/">Whiteboard</Link>
      </p>
    </main>
  );
}
