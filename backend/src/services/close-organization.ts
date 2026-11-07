// Closing an organization: an owner archives it, every future booking is
// cancelled, and each of those customers is emailed. Nothing is deleted. The
// slug stays taken by its Better Auth organization, and every lookup skips an
// archived tenant, so its pages and its members' access go with it.

import { appPool } from '../db.js';
import { withContext } from '../withContext.js';
import { emailCustomer } from './appointment-emails.js';
import type { Scope } from './owner.js';
import type { Tenant } from './tenant.js';

export async function closeOrganization(
  scope: Scope,
  org: Tenant,
): Promise<{ cancelled: number; emailed: number }> {
  const cancelled = await withContext(appPool, scope, async (client) => {
    // FOR UPDATE conflicts with the FOR KEY SHARE a booking's insert takes on
    // this row: bookings in flight finish first and are cancelled below, and
    // any that start after wait here, then fail requireNotArchived's re-check.
    await client.query('SELECT id FROM tenant WHERE id = $1 FOR UPDATE', [scope.tenantId]);
    const { rows } = await client.query<{ id: string }>(
      `UPDATE appointment SET status = 'CANCELLED'
       WHERE status = 'BOOKED' AND starts_at > now()
       RETURNING id`,
    );
    // RLS refuses this unless the caller owns the tenant.
    const closed = await client.query('UPDATE tenant SET archived_at = now() WHERE id = $1', [scope.tenantId]);
    if (closed.rowCount !== 1) throw new Error('organization was not closed');
    return rows.map((r) => r.id);
  });

  // After the commit, like every customer email: a failed send never reopens it.
  let emailed = 0;
  for (const id of cancelled) {
    if (await emailCustomer(appPool, org, id, { kind: 'closed' }, scope.userId)) emailed += 1;
  }
  return { cancelled: cancelled.length, emailed };
}
