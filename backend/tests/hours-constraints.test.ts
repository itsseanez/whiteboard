import { describe, it, expect, afterAll } from 'vitest';
import { Pool } from 'pg';
import type { PoolClient } from 'pg';

// Owner connection: these tests check CHECK and FOREIGN KEY constraints,
// not RLS, so they run as the table owner. Every case runs inside a
// transaction that is always rolled back — nothing is left in the database.
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  await ownerPool.end();
});

// Seeded by migration 1786930291394_seed-demo-tenants.
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const STAFF_A = 'a1111111-1111-1111-1111-111111111111';
const STAFF_B = 'a2222222-2222-2222-2222-222222222222'; // belongs to tenant B

// Postgres SQLSTATE codes
const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';

async function inRollback<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await ownerPool.connect();
  try {
    await client.query('BEGIN');
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

// Resolves to the SQLSTATE code if the query failed, undefined if it succeeded.
async function errorCode(query: Promise<unknown>): Promise<string | undefined> {
  try {
    await query;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

// Expected outcomes encode the rules settled for the schema:
// end after start, OR end = 00:00 (midnight, end of day) with start not 00:00.
const hoursCases: Array<{ label: string; start: string; end: string; expected: string | undefined }> = [
  { label: 'ordinary day 09:00–17:00', start: '09:00', end: '17:00', expected: undefined },
  { label: 'until midnight 22:00–00:00', start: '22:00', end: '00:00', expected: undefined },
  { label: 'midnight to midnight 00:00–00:00', start: '00:00', end: '00:00', expected: CHECK_VIOLATION },
  { label: 'reversed 17:00–09:00', start: '17:00', end: '09:00', expected: CHECK_VIOLATION },
  { label: 'zero length 09:00–09:00', start: '09:00', end: '09:00', expected: CHECK_VIOLATION },
];

describe('business_hours constraints', () => {
  it.each(hoursCases)('$label', async ({ start, end, expected }) => {
    const code = await inRollback((c) =>
      errorCode(
        c.query(
          `INSERT INTO business_hours (tenant_id, weekday, opens_at, closes_at)
           VALUES ($1, 1, $2::time, $3::time)`,
          [TENANT_A, start, end],
        ),
      ),
    );
    expect(code).toBe(expected);
  });

  it.each([0, 8])('rejects weekday %i', async (weekday) => {
    const code = await inRollback((c) =>
      errorCode(
        c.query(
          `INSERT INTO business_hours (tenant_id, weekday, opens_at, closes_at)
           VALUES ($1, $2, '09:00', '17:00')`,
          [TENANT_A, weekday],
        ),
      ),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });
});

describe('staff_working_hours constraints', () => {
  it.each(hoursCases)('$label', async ({ start, end, expected }) => {
    const code = await inRollback((c) =>
      errorCode(
        c.query(
          `INSERT INTO staff_working_hours (staff_id, tenant_id, weekday, start_time, end_time)
           VALUES ($1, $2, 1, $3::time, $4::time)`,
          [STAFF_A, TENANT_A, start, end],
        ),
      ),
    );
    expect(code).toBe(expected);
  });

  it('rejects a staff member from another tenant (composite foreign key)', async () => {
    const code = await inRollback((c) =>
      errorCode(
        c.query(
          `INSERT INTO staff_working_hours (staff_id, tenant_id, weekday, start_time, end_time)
           VALUES ($1, $2, 1, '09:00', '17:00')`,
          [STAFF_B, TENANT_A],
        ),
      ),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe('time_off constraints', () => {
  const insertTimeOff = (c: PoolClient, staffId: string, start: string, end: string) =>
    c.query(
      `INSERT INTO time_off (staff_id, tenant_id, starts_at, ends_at)
       VALUES ($1, $2, $3::timestamptz, $4::timestamptz)`,
      [staffId, TENANT_A, start, end],
    );

  it('accepts an end after the start', async () => {
    const code = await inRollback((c) =>
      errorCode(insertTimeOff(c, STAFF_A, '2026-10-30T13:00:00Z', '2026-10-30T15:00:00Z')),
    );
    expect(code).toBeUndefined();
  });

  it('rejects an end before the start', async () => {
    const code = await inRollback((c) =>
      errorCode(insertTimeOff(c, STAFF_A, '2026-10-30T15:00:00Z', '2026-10-30T13:00:00Z')),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  it('rejects a zero-length span', async () => {
    const code = await inRollback((c) =>
      errorCode(insertTimeOff(c, STAFF_A, '2026-10-30T13:00:00Z', '2026-10-30T13:00:00Z')),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  it('rejects a staff member from another tenant (composite foreign key)', async () => {
    const code = await inRollback((c) =>
      errorCode(insertTimeOff(c, STAFF_B, '2026-10-30T13:00:00Z', '2026-10-30T15:00:00Z')),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });
});