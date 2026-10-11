export function computeQueryWindow(timeZone: string, fromDate: string, throughDate: string, spanMinutes: number): { windowStart: Date; windowEnd: Date } {
  const start = Temporal.PlainDate.from(fromDate).toZonedDateTime(timeZone).toInstant().subtract({ minutes: spanMinutes });
  const end = Temporal.PlainDate.from(throughDate).add({ days: 1 }).toZonedDateTime(timeZone).toInstant().add({ minutes: spanMinutes });
  const windowStart = new Date(start.epochMilliseconds);
  const windowEnd = new Date(end.epochMilliseconds);
  return { windowStart, windowEnd };
}
