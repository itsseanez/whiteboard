// Owner calendar, shown in setup's Calendar tab (/manage/:slug?tab=calendar). A day view with a column per staff
// member, and a week view listing each day's appointments. Picking a service
// marks which times are bookable; clicking one that isn't says why. Owners can
// book, move and cancel from here.

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import {
  ApiError,
  calendarApi,
  getTenantContext,
  ownerApi,
  type CalendarAppointment,
  type CalendarData,
  type Explain,
  type ExcludedTime,
  type OwnerService,
  type HistoryEvent,
} from '@/lib/api';
import { historyLine } from '@/lib/calendar/history';
import { explain, explainFor, type ReasonContext } from '@/lib/calendar/reasons';
import { addDays, endMinutes, localHHMM, toHHMM, toMinutes, weekStart, weekdayOf } from '@/lib/calendar/grid';
import Button from '@/components/ui/Button';
import Field from '@/components/ui/Field';
import { dateToIso, dayAndMonth, organizationDate, timeOfDay, weekdayLong, weekdayShort } from '@/lib/format';
import shell from '@/styles/shell.module.css';
import styles from './Calendar.module.css';
import Problem from '@/components/ui/Problem';

const STEP = 15; // minutes per row
const ROW = 20; // px per row

type View = 'day' | 'week';

type Panel =
  | { kind: 'appointment'; appointment: CalendarAppointment }
  | { kind: 'reasons'; time: string; lines: string[] }
  | { kind: 'book'; staffId: string; startsAt: string };

const MESSAGES: Record<string, string> = {
  slot_taken: 'Someone else just took that time. Pick another.',
  slot_not_available: "That time isn't bookable any more. Pick another.",
  already_started: 'That appointment has already started.',
  not_booked: 'That appointment was already changed. Reload the calendar.',
  appointment_not_found: 'That appointment no longer exists. Reload the calendar.',
  owner_only: "Only an owner can erase a customer's details.",
  has_future_appointments: 'This customer has an upcoming booking. Cancel it first, then erase their details.',
};

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? error.code;
  return "Can't reach Whiteboard. Check your connection and try again.";
}

/** The old address; the calendar is now a tab of setup. */
export default function Calendar() {
  const { slug = '' } = useParams();
  return <Navigate to={`/manage/${slug}?tab=calendar`} replace />;
}

/** The calendar itself, shown in setup's Calendar tab. */
export function CalendarView({ slug }: { slug: string }) {
  const [timeZone, setTimeZone] = useState<string | null>(null);
    const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<View>('day');
  const [date, setDate] = useState<string | null>(null);
  const [data, setData] = useState<CalendarData | null>(null);
  const [services, setServices] = useState<OwnerService[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [explained, setExplained] = useState<Explain | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);

  useEffect(() => {
    getTenantContext(slug)
      .then(({ tenant }) => {
        setTimeZone(tenant.timezone);
        setDate(organizationDate(new Date(), tenant.timezone));
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) setProblem('signed-out');
        else if (error instanceof ApiError && error.status === 404) setProblem('not-found');
        else setProblem('failed');
      });
    ownerApi.services(slug).then(setServices, () => setServices([]));
  }, [slug]);

  const from = date ? (view === 'day' ? date : weekStart(date)) : null;
  const through = from ? (view === 'day' ? from : addDays(from, 6)) : null;

  const reload = useCallback(async () => {
    if (!from || !through) return;
    try {
      setData(await calendarApi.calendar(slug, from, through));
      if (serviceId && view === 'day') setExplained(await calendarApi.explain(slug, serviceId, from, through));
      else setExplained(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) setProblem('forbidden');
      else setProblem('failed');
    }
  }, [slug, from, through, serviceId, view]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const frame = (body: ReactNode) => <>{body}</>;


  if (problem === 'signed-out') return frame(<p className={shell.lede}><Link to="/signin">Sign in</Link> to see the calendar.</p>);
  if (problem === 'not-found') return frame(<p className={shell.lede}>You don't have an organization at this address.</p>);
  if (problem === 'forbidden') return frame(<p className={shell.lede}>Only owners and managers can see this calendar. <Link to={`/manage/${slug}/me`}>See your week</Link>.</p>);
  if (problem === 'failed') return frame(<p className={shell.lede}>Something went wrong. Try again in a moment.</p>);
  if (!timeZone || !date || !data) return frame(<p className={shell.lede}>Loading…</p>);

  const service = services.find((s) => s.id === serviceId);
  const step = view === 'day' ? 1 : 7;

  return frame(
    <>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>
            {view === 'day'
              ? `${weekdayLong(dateToIso(date), timeZone)} ${dayAndMonth(dateToIso(date), timeZone)}`
              : `Week of ${dayAndMonth(dateToIso(from!), timeZone)}`}
          </h2>
          <p className={shell.lede}>Times in {timeZone}</p>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.group} role="group" aria-label="View">
          <button type="button" aria-pressed={view === 'day'} className={styles.toggle} onClick={() => setView('day')}>Day</button>
          <button type="button" aria-pressed={view === 'week'} className={styles.toggle} onClick={() => setView('week')}>Week</button>
        </div>
        <div className={styles.group}>
          <button type="button" className={styles.toggle} onClick={() => setDate(addDays(date, -step))} aria-label="Previous">‹</button>
          <button type="button" className={styles.toggle} onClick={() => setDate(organizationDate(new Date(), timeZone))}>Today</button>
          <button type="button" className={styles.toggle} onClick={() => setDate(addDays(date, step))} aria-label="Next">›</button>
          <input type="date" className={styles.date} aria-label="Date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        {view === 'day' ? (
          <label className={styles.picker}>
            <span>Check availability for</span>
            <select value={serviceId} onChange={(e) => { setServiceId(e.target.value); setPanel(null); }}>
              <option value="">No service</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className={styles.layout}>
        {view === 'day' ? (
          <DayView
            date={date}
            data={data}
            service={service}
            explained={explained}
            onAppointment={(a) => setPanel({ kind: 'appointment', appointment: a })}
            onBook={(staffId, startsAt) => setPanel({ kind: 'book', staffId, startsAt })}
            onReasons={(time, lines) => setPanel({ kind: 'reasons', time, lines })}
          />
        ) : (
          <WeekView
            from={from!}
            data={data}
            onAppointment={(a) => setPanel({ kind: 'appointment', appointment: a })}
            onDay={(d) => { setDate(d); setView('day'); }}
          />
        )}

        {panel ? (
          <aside className={styles.panel}>
            <button type="button" className={styles.close} onClick={() => setPanel(null)}>Close</button>
            {panel.kind === 'reasons' ? (
              <>
                <h2 className={styles.panelTitle}>Why {panel.time} isn't bookable</h2>
                <ul className={styles.reasons}>{panel.lines.map((l) => <li key={l}>{l}</li>)}</ul>
              </>
            ) : null}
            {panel.kind === 'book' && service ? (
              <BookForm
                slug={slug}
                timeZone={timeZone}
                service={service}
                staffName={data.staff.find((s) => s.id === panel.staffId)?.name ?? ''}
                staffId={panel.staffId}
                startsAt={panel.startsAt}
                done={() => { setPanel(null); void reload(); }}
              />
            ) : null}
            {panel.kind === 'appointment' ? (
              <AppointmentPanel
                key={panel.appointment.id}
                slug={slug}
                timeZone={timeZone}
                date={organizationDate(new Date(panel.appointment.startsAt), timeZone)}
                appointment={panel.appointment}
                staff={data.staff}
                service={services.find((s) => s.id === panel.appointment.serviceId)}
                done={() => { setPanel(null); void reload(); }}
              />
            ) : null}
          </aside>
        ) : null}
      </div>
    </>,
  );
}

// --- day view ----------------------------------------------------------------

function DayView({
  date,
  data,
  service,
  explained,
  onAppointment,
  onBook,
  onReasons,
}: {
  date: string;
  data: CalendarData;
  service: OwnerService | undefined;
  explained: Explain | null;
  onAppointment: (a: CalendarAppointment) => void;
  onBook: (staffId: string, startsAt: string) => void;
  onReasons: (time: string, lines: string[]) => void;
}) {
  const tz = data.timeZone;
  const weekday = weekdayOf(date);
  const todays = (h: { weekday: number }) => h.weekday === weekday;

  // Rows cover the business day and anyone's hours, or 08:00–20:00 when nothing is set.
  const ranges = [...data.businessHours.filter(todays), ...data.staff.flatMap((s) => s.hours.filter(todays))];
  const first = ranges.length ? Math.min(...ranges.map((r) => toMinutes(r.start))) : 8 * 60;
  const last = ranges.length ? Math.max(...ranges.map((r) => endMinutes(r.end))) : 20 * 60;
  const start = Math.floor(first / 60) * 60;
  const end = Math.min(24 * 60, Math.ceil(last / 60) * 60);
  const rows = Array.from({ length: (end - start) / STEP }, (_, i) => start + i * STEP);
  const top = (minutes: number) => ((minutes - start) / STEP) * ROW;

  // Clamp to this day so an appointment crossing midnight still draws.
  const onThisDay = (iso: string, isEnd: boolean) => {
    const d = organizationDate(new Date(iso), tz);
    if (d < date) return start;
    if (d > date) return isEnd ? end : start;
    return toMinutes(localHHMM(iso, tz));
  };

  const day = explained?.days[0];
  const bySlot = useMemo(() => {
    const slots = new Map<string, { startsAt: string; staffIds: string[] }>();
    const excluded = new Map<string, ExcludedTime>();
    if (day?.status === 'open') {
      for (const s of day.slots) slots.set(localHHMM(s.startsAt, tz), s);
      for (const e of day.excluded) excluded.set(localHHMM(e.startsAt, tz), e);
    }
    return { slots, excluded };
  }, [day, tz]);

  const ctx: ReasonContext = {
    timeZone: tz,
    serviceName: service?.name ?? 'service',
    staffName: (id) => data.staff.find((s) => s.id === id)?.name ?? 'Someone',
    resourceName: (id) => data.appointments.find((a) => a.resourceId === id)?.resourceName ?? 'A resource',
    appointment: (id) => data.appointments.find((a) => a.id === id),
  };

  if (data.staff.length === 0) {
    return <p className={styles.empty}>No staff yet. <span>Add staff on the setup page.</span></p>;
  }

  return (
    <div className={styles.dayWrap}>
      {service && day?.status === 'closed' ? <p className={styles.note}>Closed for bookings on this day.</p> : null}
      {service && explained?.noQualifiedStaff ? <p className={styles.note}>Nobody is set up to do {service.name}.</p> : null}
      <div className={styles.day} style={{ gridTemplateColumns: `5.5rem repeat(${data.staff.length}, minmax(9rem, 1fr))` }}>
        <div className={styles.corner} />
        {data.staff.map((s) => (
          <div key={s.id} className={styles.staffHead}>
            {s.name}
            {s.archived ? <span className={styles.muted}> · removed</span> : null}
            {service && !service.staffIds.includes(s.id) ? <span className={styles.muted}> · doesn't do {service.name}</span> : null}
          </div>
        ))}

        <div className={styles.times} style={{ height: rows.length * ROW }}>
          {rows.filter((m) => m % 60 === 0).map((m) => (
            // The first label sits on the top edge; centring it on the line would hide its top half.
            <span key={m} className={m === start ? styles.firstTime : undefined} style={{ top: top(m) }}>
              {timeOfDay(`2000-01-01T${toHHMM(m)}:00Z`, 'UTC')}
            </span>
          ))}
        </div>

        {data.staff.map((s) => {
          const qualified = !!service && service.staffIds.includes(s.id);
          return (
            <div key={s.id} className={styles.column} style={{ height: rows.length * ROW }}>
              {s.hours.filter(todays).map((h, i) => (
                <div key={i} className={styles.working} style={{ top: top(toMinutes(h.start)), height: top(endMinutes(h.end)) - top(toMinutes(h.start)) }} />
              ))}
              {data.timeOff.filter((t) => t.staffId === s.id).map((t, i) => {
                const a = onThisDay(t.startsAt, false);
                const b = onThisDay(t.endsAt, true);
                return b > a ? <div key={i} className={styles.off} style={{ top: top(a), height: top(b) - top(a) }}>Off</div> : null;
              })}

              {qualified
                ? rows.map((m) => {
                    const hhmm = toHHMM(m);
                    const slot = bySlot.slots.get(hhmm);
                    const excluded = bySlot.excluded.get(hhmm);
                    const label = timeOfDay(`2000-01-01T${hhmm}:00Z`, 'UTC');
                    if (slot?.staffIds.includes(s.id)) {
                      return (
                        <button key={m} type="button" className={styles.open} style={{ top: top(m), height: ROW }}
                          aria-label={`Book ${s.name} at ${label}`} onClick={() => onBook(s.id, slot.startsAt)} />
                      );
                    }
                    const lines = excluded ? explainFor(s.id, excluded, ctx) : slot ? [`${s.name} can't take it, but someone else can.`] : [];
                    if (lines.length === 0) return null;
                    return (
                      <button key={m} type="button" className={styles.closed} style={{ top: top(m), height: ROW }}
                        aria-label={`Why not ${s.name} at ${label}`}
                        onClick={() => onReasons(label, excluded && Array.isArray(excluded.reason) ? explain(excluded, ctx) : lines)} />
                    );
                  })
                : null}

              {data.appointments.filter((a) => a.staffId === s.id).map((a) => {
                const a0 = onThisDay(a.startsAt, false);
                const a1 = onThisDay(a.endsAt, true);
                if (a1 <= a0) return null;
                return (
                  <button key={a.id} type="button" className={styles.appointment}
                    style={{ top: top(a0), height: Math.max(ROW, top(a1) - top(a0)) }}
                    onClick={() => onAppointment(a)}>
                    <strong>{timeOfDay(a.startsAt, tz)} {a.serviceName}</strong>
                    <span>{a.customer.name}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {service ? (
        <p className={styles.legend}>
          <span className={styles.swatchOpen} /> bookable, click to book · <span className={styles.swatchClosed} /> not bookable, click for why
        </p>
      ) : null}
    </div>
  );
}

// --- week view ---------------------------------------------------------------

function WeekView({
  from,
  data,
  onAppointment,
  onDay,
}: {
  from: string;
  data: CalendarData;
  onAppointment: (a: CalendarAppointment) => void;
  onDay: (date: string) => void;
}) {
  const tz = data.timeZone;
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const staffName = (id: string | null) => data.staff.find((s) => s.id === id)?.name ?? '';
  return (
    <div className={styles.week}>
      {days.map((d) => {
        const list = data.appointments.filter((a) => organizationDate(new Date(a.startsAt), tz) === d);
        return (
          <section key={d} className={styles.weekDay}>
            <button type="button" className={styles.weekHead} onClick={() => onDay(d)}>
              {weekdayShort(dateToIso(d), tz)} {dayAndMonth(dateToIso(d), tz)}
            </button>
            {list.length === 0 ? <p className={styles.muted}>Nothing booked</p> : null}
            {list.map((a) => (
              <button key={a.id} type="button" className={styles.weekItem} onClick={() => onAppointment(a)}>
                <strong>{timeOfDay(a.startsAt, tz)}</strong> {a.serviceName}
                <span>{a.customer.name} · {staffName(a.staffId)}</span>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}

// --- panels ------------------------------------------------------------------

function BookForm({
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

function AppointmentPanel({
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
