import { config } from 'dotenv';
import { afterAll } from 'vitest';

config({ path: '.env.test', override: true });

afterAll(async () => {
  const { appPool, signupPool, publicPool } = await import('../src/db.js');
  await appPool.end();
  await signupPool.end();
  await publicPool.end();
});