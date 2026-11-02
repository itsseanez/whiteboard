// A fake network for page tests. Pages use the real Better Auth client and the
// real api.ts; only fetch is replaced, with bodies captured from the dev API.

type Reply = Response | Promise<Response> | (() => Response | Promise<Response>);

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const replies = {
  wrongPassword: () =>
    json(401, { message: 'Invalid email or password', code: 'INVALID_EMAIL_OR_PASSWORD' }),
  userExists: () =>
    json(422, {
      message: 'User already exists. Use another email.',
      code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
    }),
  viteNotFound: () => new Response('', { status: 404 }),
  proxyDown: () => new Response('', { status: 502 }),
  signedIn: () =>
    json(200, {
      redirect: false,
      token: 'tok',
      user: {
        id: 'u1',
        name: 'Anna Huber',
        email: 'anna@studiowien.example',
        emailVerified: false,
        image: null,
        createdAt: '2026-11-02T07:05:04.702Z',
        updatedAt: '2026-11-02T07:05:04.702Z',
      },
    }),
  noSession: () => json(200, null),
};

export interface Call {
  method: string;
  path: string;
  body: unknown;
}

// Installed once, at import: the Better Auth client captures fetch when it is
// created (customFetchImpl in better-auth/client/config), so a fetch swapped in
// later would never be called. Import this module before any page.
let routes: Record<string, Reply> = {};
let calls: Call[] = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  // api.ts fetches relative paths, as a browser allows; Node's Request does not.
  const href = input instanceof Request ? input.url : String(input);
  const request = new Request(new URL(href, window.location.href), init);
  const url = new URL(request.url);
  const text = await request.text();
  calls.push({ method: request.method, path: url.pathname, body: text ? JSON.parse(text) : undefined });
  const reply = routes[`${request.method} ${url.pathname}`];
  if (reply === undefined) return json(404, { error: 'Not found' });
  return typeof reply === 'function' ? reply() : reply;
}) as typeof fetch;

/** Answers requests by "METHOD /path" from now on; returns the calls it records. */
export function fakeFetch(next: Record<string, Reply>): Call[] {
  routes = next;
  calls = [];
  return calls;
}
