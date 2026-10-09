/** Whether a given instant falls in Eastern Daylight Time (-4) vs Eastern Standard Time (-5). */
export function easternOffsetHours(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).formatToParts(date);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value;
  return tzName === "EDT" ? 4 : 5;
}

/**
 * An instant spelled out in Eastern time for display, e.g.
 * "Wednesday, October 28 at 10:00 PM Eastern Time" — day and month are
 * written in full, never abbreviated.
 */
export function formatEasternDateTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const day = date.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const time = date.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${day} at ${time} Eastern Time`;
}

/** The UTC Date corresponding to `hour:minute` Eastern time on a "YYYY-MM-DD" date string. */
export function etDateTime(dateStr: string, hour: number, minute: number): Date {
  const dayUtc = new Date(`${dateStr}T00:00:00Z`);
  const offsetHours = easternOffsetHours(dayUtc);
  return new Date(
    Date.UTC(
      dayUtc.getUTCFullYear(),
      dayUtc.getUTCMonth(),
      dayUtc.getUTCDate(),
      hour + offsetHours,
      minute
    )
  );
}
