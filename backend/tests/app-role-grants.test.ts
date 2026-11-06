import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { withContext } from '../src/withContext.js';

// whiteboard_app gets only the tables the code uses. Better Auth's tables hold
// password hashes and live sessions; the app reaches them only through Better
// Auth's own role.
const app = new Pool({ connectionString: process.env.APP_DATABASE_URL });
const owner = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
afterAll(async () => {
  await app.end();
  await owner.end();
});

const DENIED = '42501';

const TENANT_A = '11111111-1111-1111-1111-111111111111';

// With the session settings set, so a policy that reads them can't error first
// and hide whether the grant itself exists.
async function code(sql: string): Promise<string | undefined> {
  try {
    await withContext(app, { tenantId: TENANT_A, userId: 'nobody' }, (c) => c.query(sql));
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

describe('whiteboard_app grants', () => {
  it.each(['account', 'session', '"user"', 'verification', 'invitation', 'pgmigrations'])(
    'cannot read %s',
    async (table) => {
      expect(await code(`SELECT 1 FROM ${table} LIMIT 1`)).toBe(DENIED);
    },
  );

  it.each(['tenant', 'organization', 'member'])('can read %s but not write it', async (table) => {
    expect(await code(`SELECT 1 FROM ${table} LIMIT 1`)).toBeUndefined();
    expect(await code(`DELETE FROM ${table} WHERE false`)).toBe(DENIED);
  });

  it('cannot delete appointments or customers, only change them', async () => {
    expect(await code('DELETE FROM appointment WHERE false')).toBe(DENIED);
    expect(await code('DELETE FROM customer WHERE false')).toBe(DENIED);
  });

  it('gets nothing on a table created later until a migration grants it', async () => {
    await owner.query('CREATE TABLE grants_probe (id int)');
    try {
      expect(await code('SELECT 1 FROM grants_probe')).toBe(DENIED);
    } finally {
      await owner.query('DROP TABLE grants_probe');
    }
  });
});
