// Delivering a webhook: a signed POST to an owner's URL, from inside our
// network. That last part is the danger. A URL pointing at 127.0.0.1, a
// private address, or 169.254.169.254 (the EC2 metadata service, which hands
// out this instance's AWS credentials) must never be fetched.
//
// So the check runs when the connection is made, on the address actually
// connected to: a hostname that resolved to something public when the owner
// saved it can't resolve to 10.0.0.5 at delivery (DNS rebinding). IP literals
// skip DNS, so they're checked directly. Redirects are never followed, since
// a public URL could redirect to a private one.

import { createHmac } from 'node:crypto';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32],
] as const) blocked.addSubnet(net, bits, 'ipv6');

/** Private, loopback, link-local, metadata and other non-public addresses. */
export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1]!, 'ipv4');
  const family = isIP(address);
  if (family === 0) return true;
  return blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export class BlockedAddressError extends Error {}

// Every address the name resolves to must be public, not just the first: a
// round-robin answer could otherwise slip a private one in.
export function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: (err: Error | null, address: string | LookupAddress[], family?: number) => void,
) {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const bad = addresses.find((a) => isBlockedAddress(a.address));
    if (bad) return callback(new BlockedAddressError(`${hostname} resolves to a non-public address`), '');
    if (options.all) return callback(null, addresses);
    const first = addresses[0]!;
    callback(null, first.address, first.family);
  });
}

/** Whether a URL may be registered. Delivery checks again, on the real address. */
export function webhookUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'url must be a full URL';
  }
  const httpAllowed = process.env.NODE_ENV !== 'production';
  if (url.protocol !== 'https:' && !(httpAllowed && url.protocol === 'http:')) return 'url must use https';
  if (url.username || url.password) return 'url must not contain a username or password';
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isBlockedAddress(host) && process.env.WEBHOOK_ALLOW_PRIVATE !== '1') return 'url must be a public address';
  if (host === 'localhost' && process.env.WEBHOOK_ALLOW_PRIVATE !== '1') return 'url must be a public address';
  return null;
}

export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** One attempt. Resolves on a 2xx; throws with the reason otherwise. */
export async function deliver(target: { url: string; secret: string }, eventId: string, body: string): Promise<void> {
  const problem = webhookUrlProblem(target.url);
  if (problem) throw new BlockedAddressError(problem);
  const url = new URL(target.url);
  const timestamp = Math.floor(Date.now() / 1000);
  const allowPrivate = process.env.WEBHOOK_ALLOW_PRIVATE === '1';
  const client = url.protocol === 'https:' ? https : http;

  await new Promise<void>((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: 'POST',
        timeout: 10_000,
        ...(allowPrivate ? {} : { lookup: guardedLookup as never }),
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Whiteboard-Webhooks/1',
          'whiteboard-event-id': eventId,
          'whiteboard-signature': `t=${timestamp},v1=${sign(target.secret, timestamp, body)}`,
        },
      },
      (res) => {
        res.resume(); // the body is never read, only drained
        const status = res.statusCode ?? 0;
        if (status >= 200 && status < 300) resolve();
        else if (status >= 300 && status < 400) reject(new Error(`answered ${status}; redirects are not followed`));
        else reject(new Error(`answered ${status}`));
      },
    );
    req.on('timeout', () => req.destroy(new Error('timed out after 10 seconds')));
    req.on('error', reject);
    req.end(body);
  });
}
