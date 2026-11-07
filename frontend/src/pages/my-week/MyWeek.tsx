// A staff member's own page at /manage/:slug/me: their appointments for a week
// and their working hours. The API returns only their own appointments; the
// database is what enforces that, not this page.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError, getTenantContext, myWeekApi, type CalendarData, type HoursRange } from '@/lib/api';
import { addDays, weekStart } from '@/lib/calendar/grid';
import Button from '@/components/ui/Button';
import Problem from '@/components/ui/Problem';
import TimeOff from '@/components/organization/TimeOff';
import WeekHours from '@/components/schedule/WeekHours';
import { dateToIso, dayAndMonth, organizationDate, timeOfDay, timeOfDayAligned, weekdayLong } from '@/lib/format';
import shell from '@/styles/shell.module.css';
import styles from './MyWeek.module.css';

type Trouble = 'signed-out' | 'not-found' | 'not-staff' | 'failed';

function sameHours(a: HoursRange[], b: HoursRange[]): boolean {
  const norm = (h: HoursRange[]) =>
    JSON.stringify([...h].sort((x, y) => x.weekday - y.weekday || x.start.localeCompare(y.start)));
  return norm(a) === norm(b);
}

export default function MyWeek() {
  const { slug = '' } = useParams();
  const [org, setOrg] = useState<{ name: string; timeZone: string } | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [data, setData] = useState<CalendarData | null>(null);
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  // Bumped when time off changes, so the week shows it.
  const [version, setVersion] = useState(0);
  const reloadWeek = useCallback(() => setVersion((v) => v + 1), []);

  const fail = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) setTrouble('signed-out');
    else if (error instanceof ApiError && error.code === 'not_staff') setTrouble('not-staff');
    else if (error instanceof ApiError && error.status === 404) setTrouble('not-found');
    else setTrouble('failed');
  }, []);

  useEffect(() => {
    getTenantContext(slug)
      .then(({ tenant }) => {
        setOrg({ name: tenant.name, timeZone: tenant.timezone });
        setFrom(weekStart(organizationDate(new Date(), tenant.timezone)));
      })
      .catch(fail);
  }, [slug, fail]);

  useEffect(() => {
    if (!from) return;
    let live = true;
    myWeekApi.week(slug, from, addDays(from, 6)).then(
      (week) => live && setData(week),
      (error: unknown) => live && fail(error),
    );
    return () => {
      live = false;
    };
  }, [slug, from, fail, version]);

  const frame = (body: ReactNode) => (
    <main className={`${shell.page} ${styles.page}`}>
      {body}
    </main>
  );

  if (trouble === 'signed-out') {
    return frame(<p className={shell.lede}><Link to="/signin">Sign in</Link> to see your week.</p>);
  }
  if (trouble === 'not-found') return frame(<p className={shell.lede}>You don't belong to an organization at this address.</p>);
  if (trouble === 'not-staff') {
    return frame(<p className={shell.lede}>Your account isn't linked to a staff profile here. Ask an owner or manager for an invitation.</p>);
  }
  if (trouble === 'failed') return frame(<p className={shell.lede}>Something went wrong. Try again in a moment.</p>);
  if (!org || !from || !data) return frame(<p className={shell.lede}>Loading…</p>);

  const { timeZone } = org;
  const me = data.staff[0];
  const today = organizationDate(new Date(), timeZone);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const onDay = (iso: string, day: string) => organizationDate(new Date(iso), timeZone) === day;

  return frame(
    <>
      <h1 className={shell.title}>{me ? `${me.name}'s week` : 'Your week'}</h1>
      <p className={shell.lede}>
        {org.name} · Week of {dayAndMonth(dateToIso(from), timeZone)} · Times in {timeZone}
      </p>

      <div className={styles.toolbar} role="group" aria-label="Week">
        <Button variant="secondary" onClick={() => setFrom(addDays(from, -7))}>
          Previous week
        </Button>
        <Button variant="secondary" onClick={() => setFrom(weekStart(today))}>
          This week
        </Button>
        <Button variant="secondary" onClick={() => setFrom(addDays(from, 7))}>
          Next week
        </Button>
      </div>

      <ol className={styles.days}>
        {days.map((day) => {
          const appointments = data.appointments.filter((a) => onDay(a.startsAt, day));
          // Time off can span days: shown on every date from its start to its last moment.
          const away = data.timeOff.filter(
            (t) =>
              organizationDate(new Date(t.startsAt), timeZone) <= day &&
              organizationDate(new Date(new Date(t.endsAt).getTime() - 1), timeZone) >= day,
          );
          return (
            <li key={day} className={styles.day}>
              <h2 className={styles.dayName}>
                {weekdayLong(dateToIso(day), timeZone)} {dayAndMonth(dateToIso(day), timeZone)}
                {day === today ? <span className={styles.today}> · today</span> : null}
              </h2>
              {away.map((t) => (
                <p key={t.startsAt} className={styles.empty}>
                  Time off{t.reason ? `: ${t.reason}` : ''}
                </p>
              ))}
              {appointments.length === 0 ? (
                <p className={styles.empty}>Nothing booked.</p>
              ) : (
                appointments.map((a) => (
                  <div key={a.id} className={styles.appointment}>
                    <span className={styles.time}>
                      {timeOfDayAligned(a.startsAt, timeZone)}–{timeOfDay(a.endsAt, timeZone)}
                    </span>
                    <span className={styles.detail}>
                      <span>
                        {a.serviceName} for {a.customer.name}
                        {a.resourceName ? ` · ${a.resourceName}` : ''}
                      </span>
                      <span className={styles.contact}>
                        {a.customer.email}
                        {a.customer.phone ? ` · ${a.customer.phone}` : ''}
                      </span>
                    </span>
                  </div>
                ))
              )}
            </li>
          );
        })}
      </ol>

      {me ? <MyHours slug={slug} initial={me.hours} /> : null}

      <section className={styles.section}>
        <h2 className={styles.heading}>Your time off</h2>
        <TimeOff slug={slug} timeZone={timeZone} onChange={reloadWeek} />
      </section>
    </>,
  );
}

function MyHours({ slug, initial }: { slug: string; initial: HoursRange[] }) {
  const [hours, setHours] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const isDirty = !sameHours(hours, saved);

  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const stored = (await myWeekApi.saveHours(slug, hours)).hours;
      setHours(stored);
      setSaved(stored);
      setStatus({ ok: true, text: 'Saved.' });
    } catch (error) {
      setStatus({
        ok: false,
        text: error instanceof ApiError ? "Couldn't save your hours. Check them and try again." : "Can't reach Whiteboard. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>Your working hours</h2>
      <WeekHours label="When you work" hours={hours} onChange={setHours} disabled={busy} />
      <div className={styles.actions}>
        <Button disabled={busy} onClick={() => void save()}>
          Save hours
        </Button>
        {isDirty ? <span className={styles.unsaved}>Unsaved changes</span> : null}
      </div>
      {status ? (
        status.ok ? (
          <p className={styles.saved} role="status">
            {status.text}
          </p>
        ) : (
          <Problem role="alert">{status.text}</Problem>
        )
      ) : null}
    </section>
  );
}
