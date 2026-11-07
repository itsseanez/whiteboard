// One week: each day's appointments as a list.

import { type CalendarAppointment, type CalendarData } from '@/lib/api';
import { addDays } from '@/lib/calendar/grid';
import { dateToIso, dayAndMonth, organizationDate, timeOfDay, weekdayShort } from '@/lib/format';
import styles from './Calendar.module.css';

export function WeekView({
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
