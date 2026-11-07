// Outgoing email. Production sends through Amazon SES with the instance
// profile's credentials; development prints each message; tests keep them in
// memory so they can read the links out.
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Messages sent while MAIL_TRANSPORT=memory, newest last. */
export const outbox: Mail[] = [];

function sesMailer(from: string): Mailer {
  const client = new SESv2Client({}); // region and credentials from the environment
  return {
    async send({ to, subject, text }) {
      await client.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to] },
          Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text } } } },
        }),
      );
    },
  };
}

export class MailNotConfiguredError extends Error {}

let mailer: Mailer | undefined;

/** Throws MailNotConfiguredError when this environment can't send. */
export function getMailer(): Mailer {
  if (mailer) return mailer;
  const transport = process.env.MAIL_TRANSPORT ?? (process.env.NODE_ENV === 'production' ? '' : 'log');
  if (transport === 'ses') {
    const from = process.env.MAIL_FROM;
    if (!from) throw new MailNotConfiguredError('MAIL_FROM must be set when MAIL_TRANSPORT=ses');
    mailer = sesMailer(from);
  } else if (transport === 'log') {
    mailer = { send: async (m) => console.log(`[mail] to ${m.to}: ${m.subject}\n${m.text}`) };
  } else if (transport === 'memory') {
    mailer = { send: async (m) => void outbox.push(m) };
  } else {
    throw new MailNotConfiguredError(`MAIL_TRANSPORT must be ses, log or memory (got "${transport}")`);
  }
  return mailer;
}

/** Where links in emails point. Production serves pages and API from one
 * origin; in development the pages come from Vite. */
export function appUrl(path: string): string {
  const base =
    process.env.NODE_ENV === 'production' ? process.env.BETTER_AUTH_URL : process.env.APP_URL ?? 'http://localhost:5173';
  return new URL(path, base).toString();
}
