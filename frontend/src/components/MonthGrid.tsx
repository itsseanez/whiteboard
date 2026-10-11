import { type ReactNode } from 'react';
import type { Day } from '../api';
import { monthGrid } from '../calendar';
import styles from './MonthGrid.module.css';

interface Props {
  /** Any date in the month to display. */
  anchor: string;
  today: string;
  selected: string | null;
  /** Keyed by date. Absent means the range did not cover that date. */
  days: Map<string, Day>;
  onPick: (date: string) => void;
}

/** Monday-first, matching weekDates() and the backend's ISO weekday numbering. */
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function MonthGrid({
  anchor,
  today,
  selected,
  days,
  onPick,
}: Props): ReactNode {
  const cells = monthGrid(anchor);

  return (
    <div className={styles.grid} role="grid" aria-label="Month">
      {WEEKDAYS.map((label) => (
        <div key={label} className={styles.heading} role="columnheader">
          {label}
        </div>
      ))}

      {cells.map((cell) => {
        const day = days.get(cell.date);
        const slots = day?.status === 'open' ? day.slots.length : 0;
        const past = cell.date < today;
        // Pressable only if this month, not past, and actually has times.
        const pressable = cell.inMonth && !past && slots > 0;

        const classes = [
          styles.cell,
          cell.inMonth ? '' : styles.outside,
          pressable ? styles.open : styles.inert,
          pressable ? styles.hasTimes : undefined,
          cell.date === selected && pressable ? styles.selected : '',
          cell.date === today ? styles.today : '',
        ]
          .filter(Boolean)
          .join(' ');

        const number = Number(cell.date.slice(8, 10));

        return (
          <button
            key={cell.date}
            type="button"
            className={classes}
            disabled={!pressable}
            aria-pressed={cell.date === selected}
            // The accessible name carries what the fill encodes visually, so
            // the density map is not information only a sighted user gets.
            aria-label={`${cell.date}${pressable ? `, ${slots} ${slots === 1 ? 'time' : 'times'} free` : ', nothing free'
              }`}
            onClick={() => onPick(cell.date)}
          >
            <span className={styles.day}>{number}</span>
            {pressable ? (
              // Nested rather than three alternative strings, so the number
              // appears once in the DOM and the words reveal around it:
              // "23" → "23 slots" → "23 available slots". Three sibling spans
              // would put the count in the markup three times and leave the
              // word order impossible to get right by appending.
              <span className={styles.count}>
                {slots}
                <span className={styles.unit}>
                  {' '}
                  {slots === 1 ? 'slot' : 'slots'}

                  <span className={styles.qualifier}> available </span>
                </span>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
