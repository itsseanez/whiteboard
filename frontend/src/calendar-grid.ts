// Date and time arithmetic for the owner calendar, without Temporal (the
// browser may not have it). Dates are the organization's 'YYYY-MM-DD'; times of
// day are 'HH:MM' in its zone.

/** 'HH:MM' (24-hour) of an instant, in the given zone. */
export function localHHMM(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

export function toHHMM(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** An end of 00:00 is midnight at the end of the day. */
export function endMinutes(hhmm: string): number {
  return hhmm === '00:00' ? 24 * 60 : toMinutes(hhmm);
}

/** ISO weekday, 1 = Monday. */
export function weekdayOf(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekStart(date: string): string {
  return addDays(date, 1 - weekdayOf(date));
}
