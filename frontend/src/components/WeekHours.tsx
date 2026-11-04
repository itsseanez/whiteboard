import type { ReactNode } from 'react';
import type { HoursRange } from '../api';
import styles from './WeekHours.module.css';

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
                  <button type="button" className={styles.link} onClick={() => remove(i)}>
                    Remove
                  </button>
                </span>
              ))}
              <button type="button" className={styles.link} onClick={() => add(weekday)}>
                Add hours
              </button>
            </div>
          </div>
        );
      })}
      <p className={styles.hint}>An end of 00:00 means midnight. Add a second range for a split shift.</p>
    </fieldset>
  );
}
