// Customer emails from the public side: the confirmation carries the manage
// link, and cancelling or moving from that link sends a notice. Books Studio
// Wien on Fridays so it never shares a day with the other booking tests.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';
import { outbox } from '../src/lib/mailer.js';

const app = createApp();
const owner = new Pool({ connectionString: process.env.DATABASE_URL });
const SLUG = 'studio-wien';
const COLOR = 'b2222222-2222-2222-2222-222222222222';
const ANNA = 'a2222222-2222-2222-2222-222222222222';
const DOMAIN = 'email-test.example';

interface Slot {
  startsAt: string;
}
let slots: Slot[];

beforeAll(async () => {
  let date = Temporal.Now.plainDateISO('Europe/Vienna').add({ days: 2 });
  while (date.dayOfWeek !== 5) date = date.add({ days: 1 });
  const res = await request(app).get(`/${SLUG}/availability`).query({ serviceId: COLOR, from: date.toString() });
  slots = res.body.days[0].slots;
  if (!slots || slots.length < 2) throw new Error(`need two slots on ${date}`);
});

afterEach(async () => {
  await owner.query(
    `WITH mine AS (SELECT id FROM customer WHERE email LIKE $1),
          cleared AS (DELETE FROM appointment WHERE customer_id IN (SELECT id FROM mine))
     DELETE FROM customer WHERE id IN (SELECT id FROM mine)`,
    [`%@${DOMAIN}`],
  );
});

afterAll(async () => {
  await owner.end();
});

const mailTo = (email: string) => outbox.filter((m) => m.to === email);

async function book(email: string) {
  const res = await request(app)
    .post(`/${SLUG}/appointments`)
    .send({ serviceId: COLOR, staffId: ANNA, startsAt: slots[0]!.startsAt, customer: { name: 'Email Test', email } });
  expect(res.status).toBe(201);
  return res.body as { manageToken: string; emailed: boolean };
}

describe('customer emails', () => {
  it('confirms a booking with the manage link, in the organization’s zone', async () => {
    const email = `confirm@${DOMAIN}`;
    const booked = await book(email);
    expect(booked.emailed).toBe(true);
    const [mail] = mailTo(email);
    expect(mail?.subject).toBe('Your appointment at Studio Wien');
    expect(mail?.text).toContain(`/${SLUG}/manage?token=${encodeURIComponent(booked.manageToken)}`);
    expect(mail?.text).toContain('(Europe/Vienna)');
    expect(mail?.text).toContain('with Anna');
  });

  it('sends a notice when the customer cancels, once', async () => {
    const email = `cancel@${DOMAIN}`;
    const { manageToken } = await book(email);
    await request(app).post(`/${SLUG}/appointments/cancel`).send({ token: manageToken }).expect(200);
    await request(app).post(`/${SLUG}/appointments/cancel`).send({ token: manageToken }).expect(200);
    const notices = mailTo(email).filter((m) => m.subject.endsWith('is cancelled'));
    expect(notices).toHaveLength(1);
    expect(notices[0]!.text).toContain(`/${SLUG}`);
  });

  it('sends a notice when the customer moves it', async () => {
    const email = `move@${DOMAIN}`;
    const { manageToken } = await book(email);
    const res = await request(app)
      .post(`/${SLUG}/appointments/reschedule`)
      .send({ token: manageToken, startsAt: slots[slots.length - 1]!.startsAt });
    expect(res.status).toBe(200);
    const notice = mailTo(email).find((m) => m.subject.endsWith('has moved'));
    expect(notice?.text).toContain('use the link in your confirmation email');
  });
});
