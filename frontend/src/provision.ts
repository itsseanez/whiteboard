// Turns a signed-in user into the owner of a working organization: organization,
// membership, and a tenant row linked to that organization, via POST /me/tenants.
import { ApiError, createTenant } from './api';

export interface OrganizationInput {
  name: string;
  slug: string;
  timezone: string; // IANA id
}

// The form tells the owner "another organization already has this address" on
// slug_taken, so it must mean another account holds the slug — not the
// caller's own leftover organization from an interrupted attempt.
export type ProvisionResult =
  | { ok: true; slug: string }
  | { ok: false; reason: 'slug_taken' }
  | { ok: false; reason: 'failed'; detail?: string };

const DETAIL: Record<string, string> = {
  invalid_name: 'The organization name must be 1 to 80 characters.',
  invalid_slug: 'The page address is not valid.',
  reserved_slug: 'That page address is used by Whiteboard itself.',
  invalid_timezone: 'The time zone was not recognised.',
};

// Network failures throw, so the sign-up page shows its "can't reach" message.
export async function provisionOrganization(input: OrganizationInput): Promise<ProvisionResult> {
  try {
    const { slug } = await createTenant(input);
    return { ok: true, slug };
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    if (err.code === 'slug_taken') return { ok: false, reason: 'slug_taken' };
    const detail = DETAIL[err.code];
    return detail ? { ok: false, reason: 'failed', detail } : { ok: false, reason: 'failed' };
  }
}
