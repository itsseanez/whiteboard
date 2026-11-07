// The panel for booking a picked time.

import { useState, type FormEvent } from 'react';
import { calendarApi, type OwnerService } from '@/lib/api';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import { timeOfDay } from '@/lib/format';
import styles from './Calendar.module.css';
import Problem from '@/components/ui/Problem';
import { messageFor } from './shared';

export function BookForm({
  slug,
  timeZone,
  service,
  staffName,
  staffId,
  startsAt,
  done,
}: {
  slug: string;
  timeZone: string;
  service: OwnerService;
  staffName: string;
  staffId: string;
  startsAt: string;
  done: () => void;
}) {
  const [customer, setCustomer] = useState({ name: '', email: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const phone = customer.phone.trim();
      await calendarApi.book(slug, {
        serviceId: service.id,
        staffId,
        startsAt,
        customer: { name: customer.name.trim(), email: customer.email.trim(), ...(phone ? { phone } : {}) },
      });
      done();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={styles.form} onSubmit={submit}>
      <h2 className={styles.panelTitle}>New appointment</h2>
      <p>{service.name} with {staffName}, {timeOfDay(startsAt, timeZone)}</p>
      <Field label="Customer name" value={customer.name} onChange={(name) => setCustomer({ ...customer, name })} required maxLength={200} />
      <Field label="Email" type="email" value={customer.email} onChange={(email) => setCustomer({ ...customer, email })} required maxLength={320} />
      <Field label="Phone (optional)" type="tel" value={customer.phone} onChange={(phone) => setCustomer({ ...customer, phone })} maxLength={40} />
      {error ? <Problem role="alert">{error}</Problem> : null}
      <Button type="submit" disabled={busy || !customer.name.trim() || !customer.email.trim()}>Book</Button>
    </form>
  );
}
