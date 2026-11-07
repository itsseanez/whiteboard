// The outbox. Work is a row in job; runDueJobs claims and does it.
//
// Claiming is one statement: FOR UPDATE SKIP LOCKED picks rows nobody else is
// claiming right now, and the lease (locked_until) keeps them ours afterwards,
// so overlapping processes never do the same job. Delivery is at least once:
// a crash between sending and recording it means the job runs again.

import { appPool } from '../db.js';
import { MailNotConfiguredError, getMailer, type Mail } from '../lib/mailer.js';
import { reminder, staffNotice, timeOffNotice, type Reminder, type StaffNotice, type TimeOffNotice } from './templates.js';

type Kind = 'mail' | 'staff_notice' | 'reminder' | 'time_off_notice';

interface JobRow {
  id: string;
  kind: Kind;
  payload: unknown;
  attempts: number;
}

const LEASE = '5 minutes';
const MAX_ATTEMPTS = 50;
/** 30s, 1m, 2m … capped at an hour; expires_at bounds the total. */
export const backoffSeconds = (attempts: number) => Math.min(30 * 2 ** Math.max(attempts - 1, 0), 3600);

function compose(job: JobRow): Mail {
  switch (job.kind) {
    case 'mail':
      return job.payload as Mail;
    case 'staff_notice':
      return staffNotice(job.payload as StaffNotice);
    case 'reminder':
      return reminder(job.payload as Reminder);
    case 'time_off_notice':
      return timeOffNotice(job.payload as TimeOffNotice);
  }
}

async function finish(id: string, outcome: 'sent' | 'failed', error?: string) {
  await appPool.query(
    `UPDATE job SET finished_at = now(), outcome = $2, payload = '{}', locked_until = NULL, last_error = $3 WHERE id = $1`,
    [id, outcome, error ?? null],
  );
}

async function run(job: JobRow): Promise<void> {
  try {
    await getMailer().send(compose(job));
    await finish(job.id, 'sent');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof MailNotConfiguredError) {
      // Nothing can send yet: wait without spending an attempt.
      await appPool.query(
        `UPDATE job SET attempts = attempts - 1, locked_until = NULL, run_at = now() + interval '5 minutes', last_error = $2 WHERE id = $1`,
        [job.id, message],
      );
      return;
    }
    if (job.attempts >= MAX_ATTEMPTS) return finish(job.id, 'failed', message);
    console.error(`Job ${job.id} (${job.kind}) failed, attempt ${job.attempts}:`, message);
    await appPool.query(
      `UPDATE job SET locked_until = NULL, run_at = now() + make_interval(secs => $2), last_error = $3 WHERE id = $1`,
      [job.id, backoffSeconds(job.attempts), message],
    );
  }
}

async function claim(limit: number, id?: string): Promise<JobRow[]> {
  // Past its useful life: dropped, and its payload with it.
  await appPool.query(
    `UPDATE job SET finished_at = now(), outcome = 'expired', payload = '{}', locked_until = NULL
     WHERE finished_at IS NULL AND expires_at <= now()`,
  );
  const { rows } = await appPool.query<JobRow>(
    `WITH due AS (
       SELECT id FROM job
       WHERE finished_at IS NULL AND run_at <= now() AND (locked_until IS NULL OR locked_until < now())
         AND ($2::uuid IS NULL OR id = $2)
       ORDER BY run_at LIMIT $1
       FOR UPDATE SKIP LOCKED)
     UPDATE job SET locked_until = now() + interval '${LEASE}', attempts = job.attempts + 1
     FROM due WHERE job.id = due.id
     RETURNING job.id, job.kind, job.payload, job.attempts`,
    [limit, id ?? null],
  );
  return rows;
}

/** Claims and runs what's due. Returns how many it ran. */
export async function runDueJobs(limit = 20): Promise<number> {
  const jobs = await claim(limit);
  for (const job of jobs) await run(job);
  return jobs.length;
}

/** Queues reminders for tomorrow's appointments; harmless to call often. */
export async function queueDueReminders(): Promise<number> {
  const { rows } = await appPool.query<{ queued: number }>('SELECT enqueue_due_reminders() AS queued');
  return rows[0]?.queued ?? 0;
}

/**
 * Queues an email written in a request. Resolves once it's in the outbox,
 * not once it's sent. Under JOBS_INLINE (the tests) it's also run at once.
 */
export async function queueMail(mail: Mail, usefulFor: { hours: number } | { until: Date }): Promise<void> {
  const expires = 'until' in usefulFor ? usefulFor.until : new Date(Date.now() + usefulFor.hours * 3_600_000);
  const { rows } = await appPool.query<{ id: string }>(
    `INSERT INTO job (kind, payload, expires_at) VALUES ('mail', $1, $2) RETURNING id`,
    [mail, expires],
  );
  if (process.env.JOBS_INLINE === '1') {
    for (const job of await claim(1, rows[0]!.id)) await run(job);
  }
}

/** Clears finished jobs older than 30 days. */
export async function pruneJobs(): Promise<void> {
  await appPool.query(`DELETE FROM job WHERE finished_at < now() - interval '30 days'`);
}
