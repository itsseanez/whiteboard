// Owner calendar, shown in setup's Calendar tab (/manage/:slug?tab=calendar). A day view with a column per staff
// member, and a week view listing each day's appointments. Picking a service
// marks which times are bookable; clicking one that isn't says why. Owners can
// book, move and cancel from here.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  ApiError,
  calendarApi,
  getTenantContext,
  ownerApi,
  type CalendarData,
  type Explain,
  type OwnerService,
} from '@/lib/api';
import { addDays, weekStart } from '@/lib/calendar/grid';
import { dateToIso, dayAndMonth, organizationDate, weekdayLong } from '@/lib/format';
import shell from '@/styles/shell.module.css';
import styles from './Calendar.module.css';
import { AppointmentPanel } from './AppointmentPanel';
import { BookForm } from './BookForm';
import { DayView } from './DayView';
import { WeekView } from './WeekView';
import { type Panel, type View } from './shared';

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
