import type { Pool, PoolClient } from 'pg';

interface Context {
  tenantId?: string | undefined;
  userId?: string | undefined;
}

export async function withContext<T>(
  pool: Pool,
  context: Context,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (context.tenantId) {
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', context.tenantId]);
    }
    if (context.userId) {
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', context.userId]);
    }

    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}