// Time off: what's coming up, a form to add more, and a way to remove it.
//
// With `staff`, it's the organization's view: pick who, see everyone, approve
// or decline requests. Without, it's a staff member's own: what they add is a
// request, the server takes "nobody named" to mean "me", and lists only theirs. Either way the dates and times typed are the
// organization's wall clock, and the server turns them into instants.

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, timeOffApi, type TimeOffEntry } from '../api';
import { timeOffLabel } from '../format';
import Button from './Button';
import Field from './Field';
import IconButton, { TrashIcon } from './IconButton';
import Problem from './Problem';
import Select from './Select';
import styles from './TimeOff.module.css';

interface Props {
  slug: string;
  timeZone: string;
  /** Who time off can be added for. Leave out for a staff member's own page. */
  staff?: readonly { id: string; name: string }[];
  /** Reports whether the form holds something not yet added. */
  onDirty?: (dirty: boolean) => void;
  /** After time off is added or removed, for views that show it elsewhere. */
  onChange?: () => void;
}

const MESSAGES: Record<string, string> = {
  own_time_off_only: 'You can only add time off for yourself.',
  staff_not_found: 'That staff member no longer exists. Reload the page.',
  not_found: 'That time off was already removed. Reload the page.',
  already_decided: 'Someone already decided that request. Reload the page.',
  managers_only: 'Only owners and managers can approve time off.',
};

/** 'Added. 2 booked appointments fall in this time…', or just the first word. */
function withBookings(first: string, n: number): string {
  if (n === 0) return first;
  return `${first} ${n} booked appointment${n === 1 ? ' falls' : 's fall'} in this time and ${n === 1 ? 'is' : 'are'} still booked: move or cancel ${n === 1 ? 'it' : 'them'} in the calendar.`;
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    if (MESSAGES[error.code]) return MESSAGES[error.code]!;
    if (error.status === 400) return error.code.charAt(0).toUpperCase() + error.code.slice(1) + '.';
    return 'Something went wrong. Try again in a moment.';
  }
  return "Can't reach Whiteboard. Check your connection and try again.";
}

const EMPTY = { startDate: '', startTime: '', endDate: '', endTime: '', reason: '' };

export default function TimeOff({ slug, timeZone, staff, onDirty, onChange }: Props): ReactNode {
  const [entries, setEntries] = useState<TimeOffEntry[] | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [staffId, setStaffId] = useState(staff?.[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const dirty = Object.values(form).some((v) => v !== '');
  useEffect(() => {
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [dirty, onDirty]);

  async function load() {
    try {
      setEntries((await timeOffApi.list(slug)).timeOff);
    } catch (error) {
      setProblem(messageFor(error));
    }
  }

  useEffect(() => {
    void load();
  }, [slug]);

  const set = (patch: Partial<typeof EMPTY>) => setForm((current) => ({ ...current, ...patch }));

  async function add(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const added = await timeOffApi.add(slug, {
        ...(staff ? { staffId } : {}),
        startDate: form.startDate,
        ...(form.startTime ? { startTime: form.startTime } : {}),
        ...(form.endDate ? { endDate: form.endDate } : {}),
        ...(form.endTime ? { endTime: form.endTime } : {}),
        ...(form.reason.trim() ? { reason: form.reason.trim() } : {}),
      });
      setForm(EMPTY);
      setNotice(
        added.status === 'pending'
          ? 'Sent. An owner or manager will approve or decline it; until then, you can still be booked.'
          : withBookings('Added.', added.overlappingAppointments),
      );
      await load();
      onChange?.();
    } catch (error) {
      setProblem(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      await timeOffApi.remove(slug, id);
      setConfirming(null);
      await load();
      onChange?.();
    } catch (error) {
      setProblem(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  async function decide(id: string, decision: 'approve' | 'decline') {
    setBusy(true);
    setProblem(null);
    setNotice(null);
    try {
      const result = await timeOffApi.decide(slug, id, decision);
      setNotice(decision === 'approve' ? withBookings('Approved.', result.overlappingAppointments) : 'Declined.');
      await load();
      onChange?.();
    } catch (error) {
      setProblem(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  const waiting = entries?.filter((t) => t.status === 'pending').length ?? 0;
  // Staff may withdraw only what isn't approved; owners and managers remove anything.
  const removable = (t: TimeOffEntry) => staff !== undefined || t.status !== 'approved';

  const privacy = staff
    ? 'Only owners, managers and that staff member see the reason.'
    : 'Only you and the managers see the reason.';

  return (
    <div className={styles.timeOff}>
      {entries === null ? (
        <p className={styles.empty}>Loading…</p>
      ) : entries.length === 0 ? (
        <p className={styles.empty}>No time off coming up.</p>
      ) : (
        <>
          {staff && waiting > 0 ? (
            <p className={styles.waiting}>
              {waiting} request{waiting === 1 ? '' : 's'} waiting for a decision.
            </p>
          ) : null}
          <ul className={styles.list} aria-label="Upcoming time off">
            {entries.map((t) => (
              <li key={t.id} className={styles.entry}>
                <span className={styles.what}>
                  <span>{timeOffLabel(t.startsAt, t.endsAt, timeZone)}</span>
                  <span className={styles.who}>
                    {[staff ? t.staffName : null, t.reason].filter(Boolean).join(' · ')}
                  </span>
                  {t.status !== 'approved' ? (
                    <span className={styles.status} data-status={t.status}>
                      {t.status === 'pending' ? 'Waiting for approval' : 'Declined'}
                    </span>
                  ) : null}
                </span>
                {staff && t.status === 'pending' && confirming !== t.id ? (
                  <span className={styles.confirm}>
                    <Button variant="secondary" disabled={busy} onClick={() => void decide(t.id, 'approve')}>
                      Approve
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => void decide(t.id, 'decline')}>
                      Decline
                    </Button>
                  </span>
                ) : null}
                {!removable(t) ? null : confirming === t.id ? (
                  <span className={styles.confirm}>
                    <Button variant="secondary" disabled={busy} onClick={() => void remove(t.id)}>
                      Yes, remove
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <IconButton
                    label={`${!staff && t.status === 'pending' ? 'Withdraw request' : 'Remove time off'}: ${timeOffLabel(t.startsAt, t.endsAt, timeZone)}`}
                    disabled={busy}
                    onClick={() => setConfirming(t.id)}
                  >
                    <TrashIcon />
                  </IconButton>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <form className={styles.form} onSubmit={(event) => void add(event)}>
        <h3 className={styles.formTitle}>{staff ? 'Add time off' : 'Ask for time off'}</h3>
        <p className={styles.note}>
          Leave the times empty for whole days. Dates and times are in {timeZone}.
          {staff ? ' Time off added here is approved at once.' : ' An owner or manager approves it.'}
        </p>
        {staff ? (
          <Select
            label="Who"
            value={staffId}
            options={staff.map((s) => ({ value: s.id, label: s.name }))}
            onChange={setStaffId}
            disabled={busy}
          />
        ) : null}
        <div className={styles.pair}>
          <Field label="From" type="date" value={form.startDate} onChange={(startDate) => set({ startDate })} required disabled={busy} />
          <Field label="From time (optional)" type="time" value={form.startTime} onChange={(startTime) => set({ startTime })} disabled={busy} />
        </div>
        <div className={styles.pair}>
          <Field label="Until (optional)" type="date" value={form.endDate} onChange={(endDate) => set({ endDate })} hint="Same day if empty" disabled={busy} />
          <Field label="Until time (optional)" type="time" value={form.endTime} onChange={(endTime) => set({ endTime })} disabled={busy} />
        </div>
        <Field label="Reason (optional)" value={form.reason} onChange={(reason) => set({ reason })} maxLength={200} hint={privacy} disabled={busy} />
        <div>
          <Button type="submit" disabled={busy || !form.startDate || (staff !== undefined && !staffId)}>
            {staff ? 'Add time off' : 'Send request'}
          </Button>
        </div>
        {problem ? <Problem role="alert">{problem}</Problem> : null}
        {notice ? (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        ) : null}
      </form>
    </div>
  );
}
