import { config } from 'dotenv';
config({ path: '.env.test', override: true });

export default async function teardown() {
  const { appPool, signupPool, publicPool } = await import('../src/db.js');
  await appPool.end();
  await signupPool.end();
  await publicPool.end();
}