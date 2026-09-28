export function computeQueryWindow(timezone: string, fromDate: string, toDate: string, spanMinutes: number): { windowStart: Date; windowEnd: Date } {
  const start = Temporal.PlainDate.from(fromDate).toZonedDateTime(timezone).toInstant().subtract({ minutes: spanMinutes });
  const end = Temporal.PlainDate.from(toDate).add({ days: 1 }).toZonedDateTime(timezone).toInstant().add({ minutes: spanMinutes });
  const windowStart = new Date(start.epochMilliseconds);
  const windowEnd = new Date(end.epochMilliseconds);
  return { windowStart, windowEnd };
}
