// The panel for one appointment: details, move, cancel, history.

import { useEffect, useState } from 'react';
import {
  calendarApi,
  type CalendarAppointment,
  type CalendarData,
  type OwnerService,
  type HistoryEvent,
} from '@/lib/api';
import { historyLine } from '@/lib/calendar/history';
import Button from '@/components/ui/Button';
import { timeOfDay } from '@/lib/format';
import styles from './Calendar.module.css';
import Problem from '@/components/ui/Problem';
import { messageFor } from './shared';

export function AppointmentPanel({
  slug,
  timeZone,
  date,
  appointment,
  staff,
  service,
  done,
}: {
  slug: string;
  timeZone: string;
  date: string;
  appointment: CalendarAppointment;
  staff: CalendarData['staff'];
  service: OwnerService | undefined;
  done: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveDate, setMoveDate] = useState(date);
  const [moveStaff, setMoveStaff] = useState(appointment.staffId ?? '');
  const [times, setTimes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryEvent[] | null | 'closed'>('closed');
  const [erasing, setErasing] = useState(false);
  const a = appointment;

  async function toggleHistory() {
    if (history !== 'closed') return setHistory('closed');
    setHistory(null);
    try {
      setHistory((await calendarApi.history(slug, a.id)).events);
    } catch (e) {
      setError(messageFor(e));
      setHistory('closed');
    }
  }

  useEffect(() => {
    if (!moving || !moveStaff) return;
    setTimes(null);
    calendarApi
      .explain(slug, a.serviceId, moveDate, moveDate, moveStaff, a.id)
      .then((r) => {
        const d = r.days[0];
        setTimes(d?.status === 'open' ? d.slots.filter((s) => s.staffIds.includes(moveStaff)).map((s) => s.startsAt) : []);
      })
      .catch((e: unknown) => setError(messageFor(e)));
  }, [moving, moveDate, moveStaff, slug, a.serviceId, a.id]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      done();
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }

  const qualified = staff.filter((s) => service?.staffIds.includes(s.id) ?? s.id === a.staffId);

  return (
    <div className={styles.form}>
      <h2 className={styles.panelTitle}>{a.serviceName}</h2>
      <p>
        {timeOfDay(a.startsAt, timeZone)}–{timeOfDay(a.endsAt, timeZone)} with {staff.find((s) => s.id === a.staffId)?.name ?? 'nobody'}
        {a.resourceName ? `, ${a.resourceName}` : ''}
      </p>
      <dl className={styles.details}>
        <dt>Customer</dt><dd>{a.customer.name}</dd>
        <dt>Email</dt><dd><a href={`mailto:${a.customer.email}`}>{a.customer.email}</a></dd>
        {a.customer.phone ? (<><dt>Phone</dt><dd><a href={`tel:${a.customer.phone}`}>{a.customer.phone}</a></dd></>) : null}
      </dl>
      {error ? <Problem role="alert">{error}</Problem> : null}

      {moving ? (
        <div className={styles.move}>
          <label className={styles.picker}>
            <span>Staff</span>
            <select value={moveStaff} onChange={(e) => setMoveStaff(e.target.value)}>
              {qualified.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <input type="date" className={styles.date} aria-label="Move to date" value={moveDate} onChange={(e) => e.target.value && setMoveDate(e.target.value)} />
          {times === null ? <p className={styles.muted}>Finding times…</p> : null}
          {times?.length === 0 ? <p className={styles.muted}>No free times that day.</p> : null}
          <div className={styles.slots}>
            {times?.map((t) => (
              <button key={t} type="button" className={styles.slot} disabled={busy}
                onClick={() => act(() => calendarApi.move(slug, a.id, t, moveStaff !== a.staffId ? moveStaff : undefined))}>
                {timeOfDay(t, timeZone)}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => setMoving(false)}>Keep current time</Button>
        </div>
      ) : (
        <div className={styles.actions}>
          <Button variant="secondary" disabled={busy} onClick={() => setMoving(true)}>Move</Button>
          {confirming ? (
            <Button disabled={busy} onClick={() => act(() => calendarApi.cancel(slug, a.id))}>Yes, cancel it</Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(true)}>Cancel appointment</Button>
          )}
        </div>
      )}
      <p className={styles.muted}>The customer is emailed when you move or cancel this.</p>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => void toggleHistory()}>
          {history === 'closed' ? 'History' : 'Hide history'}
        </Button>
        {erasing ? (
          <Button disabled={busy} onClick={() => act(() => calendarApi.eraseCustomer(slug, a.customer.id))}>
            Yes, erase {a.customer.name}'s details
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => setErasing(true)}>
            Erase customer's details…
          </Button>
        )}
      </div>
      {erasing ? (
        <p className={styles.muted}>
          For a customer who asks to be forgotten. Their name, email and phone are removed from every appointment they
          had here; the appointments themselves stay. This can't be undone.
        </p>
      ) : null}
      {history === null ? <p className={styles.muted}>Loading history…</p> : null}
      {Array.isArray(history) ? (
        <ol className={styles.history} aria-label="History">
          {history.map((event, i) => {
            const line = historyLine(event, timeZone);
            return (
              <li key={i}>
                <span>{line.what}</span>
                <span className={styles.muted}>{line.when}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
