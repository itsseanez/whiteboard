import { config } from 'dotenv';
import { afterAll } from 'vitest';

config({ path: '.env.test', override: true });
process.env.MAIL_TRANSPORT = 'memory';
// Queued mail is sent as it's queued, so tests read the outbox as before.
process.env.JOBS_INLINE = '1';

afterAll(async () => {
  const { appPool, signupPool, publicPool } = await import('../src/db.js');
  await appPool.end();
  await signupPool.end();
  await publicPool.end();
});
