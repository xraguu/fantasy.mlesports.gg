/** Whether a given instant falls in Eastern Daylight Time (-4) vs Eastern Standard Time (-5). */
export function easternOffsetHours(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).formatToParts(date);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value;
  return tzName === "EDT" ? 4 : 5;
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
