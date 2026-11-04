import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import { withContext } from '../src/withContext.js';

// One connection, so the second transaction reuses the first one's session.
const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL, max: 1 });
afterAll(() => pool.end());

const TENANT_A = '11111111-1111-1111-1111-111111111111';

describe('pooled connection reuse', () => {
  it('a leftover empty app.tenant_id does not break the membership branch of tenant_select_app', async () => {
    await withContext(pool, { tenantId: TENANT_A }, (c) => c.query('SELECT 1'));
    // app.tenant_id is now '' on this connection, not unset.
    const rows = await withContext(pool, { userId: 'nobody' }, async (c) => {
      const { rows } = await c.query("SELECT current_setting('app.tenant_id', true) AS s, (SELECT count(*)::int FROM tenant) AS n");
      return rows;
    });
    expect(rows[0].s).toBe('');
    expect(rows[0].n).toBe(0);
  });
});
