// Erasing a customer's details when they ask to be forgotten. Their
// appointments stay, as history, attached to a customer with no name, email
// or phone. Owners only.

import { appPool } from '../db.js';
import { withContext } from '../withContext.js';
import { HasFutureAppointmentsError, NotFoundError, type Scope } from './owner.js';

export async function eraseCustomer(scope: Scope, customerId: string): Promise<void> {
  await withContext(appPool, scope, async (client) => {
    // Locked first: a booking under the same email waits for this, then finds
    // the address gone and makes a new customer instead of joining this one.
    const { rows } = await client.query<{ email: string }>('SELECT email FROM customer WHERE id = $1 FOR UPDATE', [customerId]);
    const customer = rows[0];
    if (!customer) throw new NotFoundError();

    // Someone still coming in needs a way to be told about it.
    const upcoming = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM appointment WHERE customer_id = $1 AND status = 'BOOKED' AND starts_at > now()`,
      [customerId],
    );
    const count = upcoming.rows[0]?.n ?? 0;
    if (count > 0) throw new HasFutureAppointmentsError(count);

    // @invalid can never be delivered to (RFC 2606), and stays unique per customer.
    await client.query(
      `UPDATE customer SET name = 'Erased customer', email = 'erased-' || id || '@invalid', phone = NULL WHERE id = $1`,
      [customerId],
    );
    // Webhooks not yet delivered would still carry the details.
    await client.query(
      `UPDATE job SET finished_at = now(), outcome = 'cancelled', payload = '{}'
       WHERE finished_at IS NULL AND ref IN (SELECT id FROM webhook_endpoint)
         AND lower(payload->'data'->'customer'->>'email') = lower($1)`,
      [customer.email],
    );
  });
}
