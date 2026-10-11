import { type ReactNode } from 'react';
import type { Day, Slot } from '../api';
import { timeOfDay, timeOfDayAligned } from '../format';
import styles from './DayTimes.module.css';

interface Props {
  day: Day | undefined;
  timeZone: string;
  selected: Slot | null;
  onPick: (slot: Slot) => void;
}

export default function DayTimes({ day, timeZone, selected, onPick }: Props): ReactNode {
  if (!day) return <p className={styles.empty}>Loading times…</p>;

  if (day.status === 'closed') {
    return <p className={styles.empty}>The salon is closed this day.</p>;
  }

  if (day.slots.length === 0) {
    // Open but nothing free. Distinct from closed, and worth saying so: the
    // customer's next move is a different day, not a different salon.
    return <p className={styles.empty}>No times left this day. Try another.</p>;
  }

  return (
    <div className={styles.times}>
      {day.slots.map((slot) => (
        <button
          key={slot.startsAt}
          type="button"
          className={`${styles.slot} ${selected?.startsAt === slot.startsAt ? styles.slotOn : ''}`}
          aria-pressed={selected?.startsAt === slot.startsAt}
          aria-label={timeOfDay(slot.startsAt, timeZone)}
          onClick={() => onPick(slot)}
        >
          {timeOfDayAligned(slot.startsAt, timeZone)}
        </button>
      ))}
    </div>
  );
}
