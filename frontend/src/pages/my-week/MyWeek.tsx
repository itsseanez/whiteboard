// A staff member's own page at /manage/:slug/me, in tabs like the owner's: their
// week, their working hours (owners and managers set them) and their time off.
// The open tab is in ?tab=. The API returns only their own appointments; the
// database is what enforces that, not this page.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { ApiError, getTenantContext, myWeekApi, type CalendarData, type HoursRange } from '@/lib/api';
import { addDays, weekStart } from '@/lib/calendar/grid';
import Button from '@/components/ui/Button';
import Tabs from '@/components/ui/Tabs';
import TimeOff from '@/components/organization/TimeOff';
import { dateToIso, dayAndMonth, organizationDate, timeOfDay, timeOfDayAligned, weekdayLong } from '@/lib/format';
import shell from '@/styles/shell.module.css';
import styles from './MyWeek.module.css';

type Trouble = 'signed-out' | 'not-found' | 'not-staff' | 'failed';

const TABS = ['week', 'hours', 'time-off'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function MyWeek() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = TABS.includes(params.get('tab') ?? '') ? params.get('tab')! : 'week';
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
    <main className={shell.page}>
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
        {org.name} · Times in {timeZone}
      </p>

      <Tabs
        label="Your page"
        orientation="vertical"
        selected={tab}
        onSelect={(id) => setParams({ tab: id }, { replace: true })}
        tabs={[
          {
            id: 'week',
            label: 'Week',
            panel: (
              <div className={styles.column}>
                <h2 className={styles.heading}>Week of {dayAndMonth(dateToIso(from), timeZone)}</h2>
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
              </div>
            ),
          },
          {
            id: 'hours',
            label: 'Working hours',
            panel: (
              <div className={styles.column}>
                <h2 className={styles.heading}>Your working hours</h2>
                <p className={styles.note}>Set by an owner or manager. Ask one of them to change them.</p>
                <HoursList hours={me?.hours ?? []} />
              </div>
            ),
          },
          {
            id: 'time-off',
            label: 'Time off',
            panel: (
              <div className={styles.column}>
                <h2 className={styles.heading}>Your time off</h2>
                <TimeOff slug={slug} timeZone={timeZone} onChange={reloadWeek} />
              </div>
            ),
          },
        ]}
      />
    </>,
  );
}

/** Each day's ranges, or "Not working". Times are the organization's wall clock. */
function HoursList({ hours }: { hours: HoursRange[] }) {
  return (
    <dl className={styles.hours}>
      {DAYS.map((name, i) => {
        const ranges = hours.filter((h) => h.weekday === i + 1).sort((a, b) => a.start.localeCompare(b.start));
        return (
          <div key={name} className={styles.hoursRow}>
            <dt>{name}</dt>
            <dd>{ranges.length ? ranges.map((r) => `${r.start}–${r.end}`).join(', ') : <span className={styles.empty}>Not working</span>}</dd>
          </div>
        );
      })}
    </dl>
  );
}
