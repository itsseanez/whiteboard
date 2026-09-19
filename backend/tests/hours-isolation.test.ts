import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { appPool } from '../src/db.js';
import { withContext } from '../src/withContext.js';

// Two connections on purpose:
// - ownerPool (table owner) creates and removes fixtures. The owner bypasses RLS,
//   so it can write both tenants' rows.
// - appPool (whiteboard_app) makes every assertion. RLS applies to it, which is
//   the point: a test run as the owner would see everything and prove nothing.
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });

// Seeded by migration 1786930291394_seed-demo-tenants.
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const STAFF_A = 'a1111111-1111-1111-1111-111111111111';
const STAFF_B = 'a2222222-2222-2222-2222-222222222222';

const RLS_VIOLATION = '42501';

const TABLES = ['business_hours', 'staff_working_hours', 'time_off'] as const;
type Table = (typeof TABLES)[number];

// One fixture row per table per tenant, created in beforeAll.
const fixtures: Record<Table, { a: string; b: string }> = {
  business_hours: { a: '', b: '' },
  staff_working_hours: { a: '', b: '' },
  time_off: { a: '', b: '' },
};

// Insert statements for a single row belonging to the given tenant/staff pair.
function insertSql(table: Table): string {
  switch (table) {
    case 'business_hours':
      return `INSERT INTO business_hours (tenant_id, weekday, opens_at, closes_at)
              VALUES ($1, 1, '09:00', '17:00') RETURNING id`;
    case 'staff_working_hours':
      return `INSERT INTO staff_working_hours (tenant_id, staff_id, weekday, start_time, end_time)
              VALUES ($1, $2, 1, '09:00', '17:00') RETURNING id`;
    case 'time_off':
      return `INSERT INTO time_off (tenant_id, staff_id, starts_at, ends_at)
              VALUES ($1, $2, '2026-10-30T13:00:00Z', '2026-10-30T15:00:00Z') RETURNING id`;
  }
}

function insertParams(table: Table, tenantId: string, staffId: string): string[] {
  return table === 'business_hours' ? [tenantId] : [tenantId, staffId];
}

async function ownerInsert(table: Table, tenantId: string, staffId: string): Promise<string> {
  const result = await ownerPool.query<{ id: string }>(
    insertSql(table),
    insertParams(table, tenantId, staffId),
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error(`Fixture insert into ${table} returned no id`);
  return id;
}

async function errorCode(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

beforeAll(async () => {
  for (const table of TABLES) {
    fixtures[table].a = await ownerInsert(table, TENANT_A, STAFF_A);
    fixtures[table].b = await ownerInsert(table, TENANT_B, STAFF_B);
  }
});

afterAll(async () => {
  for (const table of TABLES) {
    await ownerPool.query(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, [
      [fixtures[table].a, fixtures[table].b].filter(Boolean),
    ]);
  }
  await ownerPool.end();
});

describe.each(TABLES)('%s isolation (as whiteboard_app)', (table) => {
  it("reads only the current tenant's rows", async () => {
    const rows = await withContext(appPool, { tenantId: TENANT_A }, async (client) => {
      const result = await client.query<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM ${table}`,
      );
      return result.rows;
    });

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(fixtures[table].a);
    expect(ids).not.toContain(fixtures[table].b);
    expect(rows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
  });

  it("cannot update another tenant's row", async () => {
    const rowCount = await withContext(appPool, { tenantId: TENANT_A }, async (client) => {
      const result = await client.query(
        `UPDATE ${table} SET updated_at = now() WHERE id = $1`,
        [fixtures[table].b],
      );
      return result.rowCount;
    });
    // RLS makes the row invisible, so the UPDATE matches nothing rather than erroring.
    expect(rowCount).toBe(0);
  });

  it("cannot delete another tenant's row", async () => {
    const rowCount = await withContext(appPool, { tenantId: TENANT_A }, async (client) => {
      const result = await client.query(`DELETE FROM ${table} WHERE id = $1`, [fixtures[table].b]);
      return result.rowCount;
    });
    expect(rowCount).toBe(0);
  });

  it('cannot insert a row for another tenant', async () => {
    // Tenant B's own staff member, so the composite foreign key is satisfied
    // and only the RLS WITH CHECK clause can reject it.
    const code = await errorCode(
      withContext(appPool, { tenantId: TENANT_A }, (client) =>
        client.query(insertSql(table), insertParams(table, TENANT_B, STAFF_B)),
      ),
    );
    expect(code).toBe(RLS_VIOLATION);
  });

  it('fails closed with no tenant context', async () => {
    // The policy uses the one-argument current_setting(), which throws if the
    // setting was never defined on this connection. On a pooled connection that
    // previously ran a transaction with it set, it reads back as '' and the
    // ::uuid cast throws instead. Either way the query must not return rows,
    // so this asserts only that it fails.
    await expect(
      withContext(appPool, {}, (client) => client.query(`SELECT id FROM ${table}`)),
    ).rejects.toThrow();
  });
});