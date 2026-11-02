// Turns a signed-in user into the owner of a working salon: organization,
// membership, and a tenant row linked to that organization. Sean writes this —
// see SIGNIN-BRIEF §7. The sign-up form depends only on this signature.

export interface SalonInput {
  name: string;
  slug: string;
  timezone: string; // IANA id
}

// The form tells the owner "another salon already has this address" on
// slug_taken, so it must mean another account holds the slug — not the
// caller's own leftover organization from an interrupted attempt.
export type ProvisionResult =
  | { ok: true; slug: string }
  | { ok: false; reason: 'slug_taken' }
  | { ok: false; reason: 'failed'; detail?: string };

export async function provisionSalon(_input: SalonInput): Promise<ProvisionResult> {
  return { ok: false, reason: 'failed', detail: 'Salon provisioning is not written yet.' };
}
