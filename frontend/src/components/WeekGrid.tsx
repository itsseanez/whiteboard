import { type ReactNode } from 'react';
import type { Day, Slot } from '../api';
import { weekDates } from '../calendar';
import { dateToIso, timeOfDay, weekdayShort } from '../format';
import styles from './WeekGrid.module.css';

interface Props {
  anchor: string;
  today: string;
  timeZone: string;
  days: Map<string, Day>;
  selected: Slot | null;
  onPick: (date: string, slot: Slot) => void;
}

export default function WeekGrid({
  anchor,
  today,
  timeZone,
  days,
  selected,
  onPick,
}: Props): ReactNode {
  const dates = weekDates(anchor);

  return (
    <div className={styles.week}>
      {dates.map((date) => {
        const day = days.get(date);
        const slots = day?.status === 'open' ? day.slots : [];
        const past = date < today;

        return (
          <div key={date} className={styles.column}>
            <div className={`${styles.head} ${date === today ? styles.headToday : ''}`}>
              {/* weekdayShort formats in the salon's zone, from a midday
                * instant, so a date-only value cannot slip to the day before. */}
              <span className={styles.weekday}>{weekdayShort(dateToIso(date), timeZone)}</span>
              <span className={styles.date}>{Number(date.slice(8, 10))}</span>
            </div>

            {past || slots.length === 0 ? (
              <p className={styles.shut}>{past ? '—' : 'Closed'}</p>
            ) : (
              <div className={styles.times}>
                {slots.map((slot) => (
                  <button
                    key={slot.startsAt}
                    type="button"
                    className={`${styles.slot} ${
                      selected?.startsAt === slot.startsAt ? styles.slotOn : ''
                    }`}
                    aria-pressed={selected?.startsAt === slot.startsAt}
                    onClick={() => onPick(date, slot)}
                  >
                    {timeOfDay(slot.startsAt, timeZone)}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
