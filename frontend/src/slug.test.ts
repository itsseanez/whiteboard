import { describe, expect, it } from 'vitest';
import { slugify, slugProblem } from './slug';

describe('slugify', () => {
  it.each([
    ["Marina's Cuts & Color", 'marinas-cuts-color'],
    ['Café Zürich', 'cafe-zurich'],
    ['  --Studio   Wien--  ', 'studio-wien'],
    ['UPPER case 42', 'upper-case-42'],
    ['!!!', ''],
  ])('%j -> %j', (name, want) => {
    expect(slugify(name)).toBe(want);
  });

  it('cuts to 40 characters without leaving a trailing hyphen', () => {
    // 39 letters, a space, then more: the cut lands right after the hyphen.
    const name = `${'a'.repeat(39)} bcd`;
    expect(slugify(name)).toBe('a'.repeat(39));
  });
});

describe('slugProblem', () => {
  it.each(['studio-wien', 'abc', 'organization-42', 'a'.repeat(40)])('accepts %j', (slug) => {
    expect(slugProblem(slug)).toBeNull();
  });

  it.each([
    ['ab', 'too short'],
    ['a'.repeat(41), 'too long'],
    ['Studio', 'uppercase'],
    ['studio--wien', 'double hyphen'],
    ['-studio', 'leading hyphen'],
    ['studio-', 'trailing hyphen'],
    ['studio wien', 'space'],
    ['café', 'non-ascii'],
  ])('rejects %j (%s)', (slug) => {
    expect(slugProblem(slug)).not.toBeNull();
  });

  // Each of these is a path the app or API already owns; an organization there would
  // shadow it or be shadowed by it.
  it.each(['signin', 'signup', 'account', 'manage', 'api', 'me', 'tenant', 'assets'])(
    'rejects the reserved slug %j',
    (slug) => {
      expect(slugProblem(slug)).toMatch(/used by Whiteboard/);
    },
  );

  it('does not reserve near-misses of reserved words', () => {
    expect(slugProblem('apiary')).toBeNull();
    expect(slugProblem('meadow')).toBeNull();
  });
});
