// /tenant/:slug/webhooks — owners only.
//   GET            endpoints, each with its ten latest deliveries
//   POST           { url }  → { id, url, secret }, the secret shown this once
//   DELETE /:id
//   POST   /:id/test        queue a ping

import type { Request, Response } from 'express';
import { scope } from '../lib/scope.js';
import { NotFoundError } from '../services/owner.js';
import { WebhookInputError, addWebhook, listWebhooks, pingWebhook, removeWebhook } from '../services/webhooks.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getWebhooks(req: Request, res: Response) {
  res.json({ webhooks: await listWebhooks(scope(req)) });
}

export async function postWebhook(req: Request, res: Response) {
  const url = (req.body as { url?: unknown } | undefined)?.url;
  if (typeof url !== 'string') return res.status(400).json({ error: 'url is required' });
  try {
    res.status(201).json(await addWebhook(scope(req), url.trim()));
  } catch (error) {
    if (error instanceof WebhookInputError) return res.status(400).json({ error: error.message });
    throw error;
  }
}

function byId(fn: (s: ReturnType<typeof scope>, id: string) => Promise<void>, status: number) {
  return async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== 'string' || !UUID.test(id)) return res.status(404).json({ error: 'not_found' });
    try {
      await fn(scope(req), id);
      res.status(status).end();
    } catch (error) {
      if (error instanceof NotFoundError) return res.status(404).json({ error: 'not_found' });
      throw error;
    }
  };
}

export const deleteWebhook = byId(removeWebhook, 204);
export const testWebhook = byId(pingWebhook, 202);
