// Slugs no organization may take, because the path /<slug> or /<slug>/... is already
// claimed. Keep in sync with the page routes in main.tsx and the mounts in
// backend/src/app.ts. This is the form's check only; the server refuses these
// too, from its own copy in backend/src/lib/tenant-input.ts.
const RESERVED = new Set([
  'signin', // page
  'signup', // page
  'account', // page
  'manage', // no collision today; held for a future owner route
  'api', // /api/auth/* — Better Auth
  'me', // /me/* would shadow an organization's /me/services
  'tenant', // /tenant/:slug would shadow an organization's /tenant/services
  'assets', // the built client's static files
]);

const SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

/** A suggested slug for an organization name. The owner can edit it. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // accents NFKD split off
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '');
}

/** What is wrong with the slug, as a sentence, or null if it is usable. */
export function slugProblem(slug: string): string | null {
  if (RESERVED.has(slug)) return `"${slug}" is used by Whiteboard itself. Pick another.`;
  if (slug.length < SLUG_MIN) return `At least ${SLUG_MIN} characters.`;
  if (slug.length > SLUG_MAX) return `At most ${SLUG_MAX} characters.`;
  if (!SHAPE.test(slug)) return 'Lowercase letters and numbers, with single hyphens between.';
  return null;
}
