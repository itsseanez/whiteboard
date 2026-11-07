import type { ReactNode } from 'react';
import type { HoursRange } from '@/lib/api';
import { timeOfDay } from '@/lib/format';
import IconButton, { TrashIcon } from '@/components/ui/IconButton';
import styles from './WeekHours.module.css';

// "12:00 AM" or "00:00", whichever the viewer's time picker shows for midnight.
const MIDNIGHT = timeOfDay('2000-01-01T00:00:00Z', 'UTC');

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface Props {
  label: string;
  hours: HoursRange[];
  onChange: (hours: HoursRange[]) => void;
  disabled?: boolean;
}

/** Seven days, each with zero or more ranges. A day with none is closed. */
export default function WeekHours({ label, hours, onChange, disabled }: Props): ReactNode {
  const update = (index: number, patch: Partial<HoursRange>) =>
    onChange(hours.map((h, i) => (i === index ? { ...h, ...patch } : h)));
  const remove = (index: number) => onChange(hours.filter((_, i) => i !== index));
  const add = (weekday: number) => onChange([...hours, { weekday, start: '09:00', end: '17:00' }]);

  return (
    <fieldset className={styles.week} disabled={disabled}>
      <legend className={styles.legend}>{label}</legend>
      {DAYS.map((day, d) => {
        const weekday = d + 1;
        const ranges = hours.map((h, i) => ({ h, i })).filter(({ h }) => h.weekday === weekday);
        return (
          <div key={day} className={styles.day}>
            <span className={styles.dayName}>{day}</span>
            <div className={styles.ranges}>
              {ranges.length === 0 ? <span className={styles.closed}>Closed</span> : null}
              {ranges.map(({ h, i }) => (
                <span key={i} className={styles.range}>
                  <input
                    type="time"
                    aria-label={`${day} start`}
                    value={h.start}
                    onChange={(e) => update(i, { start: e.target.value })}
                  />
                  <span aria-hidden="true">–</span>
                  <input
                    type="time"
                    aria-label={`${day} end`}
                    value={h.end}
                    onChange={(e) => update(i, { end: e.target.value })}
                  />
                  <IconButton size="small" label={`Remove ${day} ${h.start}–${h.end}`} onClick={() => remove(i)}>
                    <TrashIcon />
                  </IconButton>
                </span>
              ))}
              <button type="button" className={styles.link} onClick={() => add(weekday)}>
                Add hours
              </button>
            </div>
          </div>
        );
      })}
      <p className={styles.hint}>
        An end of {MIDNIGHT} means open until midnight. Add hours twice on one day for a split shift.
      </p>
    </fieldset>
  );
}
