// An owner's webhooks: where appointment changes are POSTed, and how the
// latest deliveries went. The signing secret is shown once, when added.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, webhookApi, type Webhook, type WebhookDelivery } from '../api';
import Button from './Button';
import Field from './Field';
import IconButton, { TrashIcon } from './IconButton';
import Problem from './Problem';
import styles from './Webhooks.module.css';

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) {
      const text = error.code.replace(/^url\b/, 'The URL');
      return text.charAt(0).toUpperCase() + text.slice(1) + '.';
    }
    if (error.code === 'owner_only') return 'Only owners can manage webhooks.';
    return 'Something went wrong. Try again in a moment.';
  }
  return "Can't reach Whiteboard. Check your connection and try again.";
}

function status(d: WebhookDelivery): string {
  switch (d.outcome) {
    case 'sent':
      return d.attempts > 1 ? `delivered after ${d.attempts} tries` : 'delivered';
    case 'failed':
      return `not delivered: ${d.lastError ?? 'failed'}`;
    case 'expired':
      return `gave up after ${d.attempts} tries${d.lastError ? `: ${d.lastError}` : ''}`;
    case 'cancelled':
      return 'not sent: webhook removed';
    default:
      return d.attempts === 0 ? 'waiting' : `retrying: ${d.lastError ?? 'failed'}`;
  }
}

export default function Webhooks({ slug }: { slug: string }): ReactNode {
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ url: string; secret: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function load() {
    try {
      setHooks((await webhookApi.list(slug)).webhooks);
    } catch (error) {
      setProblem(messageFor(error));
    }
  }

  useEffect(() => {
    void load();
  }, [slug]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await fn();
      await load();
    } catch (error) {
      setProblem(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    await act(async () => {
      const created = await webhookApi.add(slug, url.trim());
      setSecret({ url: created.url, secret: created.secret });
      setUrl('');
    });
  }

  return (
    <div className={styles.webhooks}>
      <p className={styles.note}>
        Every booking, move and cancellation is sent as a signed JSON POST, with the customer's name, email and phone.
        Check the <code>Whiteboard-Signature</code> header with your secret before trusting a request. Failed
        deliveries are retried for three days.
      </p>
      {problem ? <Problem role="alert">{problem}</Problem> : null}
      {secret ? (
        <div className={styles.secret} role="status">
          <strong>Copy this secret now. It won't be shown again.</strong>
          <code>{secret.secret}</code>
          <span className={styles.note}>For {secret.url}</span>
          <div>
            <Button variant="secondary" onClick={() => setSecret(null)}>
              I've saved it
            </Button>
          </div>
        </div>
      ) : null}
      {hooks === null ? (
        <p className={styles.note}>Loading…</p>
      ) : hooks.length === 0 ? (
        <p className={styles.note}>No webhooks yet.</p>
      ) : (
        <ul className={styles.list} aria-label="Webhooks">
          {hooks.map((h) => (
            <li key={h.id} className={styles.hook}>
              <div className={styles.head}>
                <code className={styles.url}>{h.url}</code>
                <span className={styles.actions}>
                  <Button variant="secondary" disabled={busy} onClick={() => void act(() => webhookApi.test(slug, h.id))}>
                    Send a test
                  </Button>
                  {confirming === h.id ? (
                    <>
                      <Button variant="secondary" disabled={busy} onClick={() => void act(() => webhookApi.remove(slug, h.id))}>
                        Yes, remove
                      </Button>
                      <Button variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <IconButton label={`Remove webhook ${h.url}`} disabled={busy} onClick={() => setConfirming(h.id)}>
                      <TrashIcon />
                    </IconButton>
                  )}
                </span>
              </div>
              {h.deliveries.length > 0 ? (
                <ol className={styles.deliveries} aria-label={`Latest deliveries to ${h.url}`}>
                  {h.deliveries.map((d, i) => (
                    <li key={i} data-outcome={d.outcome ?? 'pending'}>
                      <span>{d.label}</span>
                      <span>{status(d)}</span>
                      <span className={styles.when}>{new Date(d.createdAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className={styles.note}>Nothing sent yet.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className={styles.form} onSubmit={(event) => void add(event)}>
        <Field label="Webhook URL" value={url} onChange={setUrl} hint="https only. Up to five." disabled={busy} />
        <div>
          <Button type="submit" disabled={busy || !url.trim()}>
            Add webhook
          </Button>
        </div>
      </form>
    </div>
  );
}
