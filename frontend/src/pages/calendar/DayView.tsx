// One day: a column per staff member, appointments placed on a 15-minute grid.

import { useMemo } from 'react';
import {
  type CalendarAppointment,
  type CalendarData,
  type Explain,
  type ExcludedTime,
  type OwnerService,
} from '@/lib/api';
import { explain, explainFor, type ReasonContext } from '@/lib/calendar/reasons';
import { endMinutes, localHHMM, toHHMM, toMinutes, weekdayOf } from '@/lib/calendar/grid';
import { organizationDate, timeOfDay } from '@/lib/format';
import styles from './Calendar.module.css';
import { ROW, STEP } from './shared';

export function DayView({
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
