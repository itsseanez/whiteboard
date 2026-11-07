// Server-side checks for a new tenant. The sign-up form runs the same slug
// rules (frontend/src/slug.ts); keep the two lists in sync.
const RESERVED = new Set(['signin', 'signup', 'account', 'manage', 'invite', 'links', 'api', 'me', 'tenant', 'assets']);
const SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MIN = 3;
const SLUG_MAX = 40;
const NAME_MAX = 80;

export interface TenantInput {
  name: string;
  slug: string;
  timezone: string;
}

export type InputError = 'invalid_name' | 'invalid_slug' | 'reserved_slug' | 'invalid_timezone';

export type ParsedInput = { ok: true; value: TenantInput } | { ok: false; error: InputError };

// Parsed with the same Temporal call the availability engine makes, so a zone
// accepted here is one the engine can use. Offsets are refused: they don't survive DST.
function normaliseTimeZone(raw: string): string | null {
  if (/^[+-]/.test(raw)) return null;
  try {
    return Temporal.Now.zonedDateTimeISO(raw).timeZoneId;
  } catch {
    return null;
  }
}

export function parseTenantInput(body: unknown): ParsedInput {
  const { name, slug, timezone } = (body ?? {}) as Record<string, unknown>;

  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed.length < 1 || trimmed.length > NAME_MAX) return { ok: false, error: 'invalid_name' };

  if (typeof slug !== 'string') return { ok: false, error: 'invalid_slug' };
  if (RESERVED.has(slug)) return { ok: false, error: 'reserved_slug' };
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX || !SHAPE.test(slug)) {
    return { ok: false, error: 'invalid_slug' };
  }

  const zone = typeof timezone === 'string' ? normaliseTimeZone(timezone) : null;
  if (!zone) return { ok: false, error: 'invalid_timezone' };

  return { ok: true, value: { name: trimmed, slug, timezone: zone } };
}
