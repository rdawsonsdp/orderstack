/**
 * Business-hours logic. Pure functions over the business_hours /
 * hour_overrides rows so they're testable without a DB. All comparisons
 * happen in the restaurant's IANA timezone via Intl (no date library).
 */

export interface HoursRow {
  day_of_week: number; // 0 = Sunday
  opens: string; // "11:00:00" or "11:00"
  closes: string;
}

export interface OverrideRow {
  date: string; // "2026-11-26" (restaurant-local date)
  closed: boolean;
  opens: string | null;
  closes: string | null;
}

interface LocalParts {
  date: string; // YYYY-MM-DD
  dayOfWeek: number; // 0 = Sunday
  minutes: number; // minutes since local midnight
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localParts(at: Date, timeZone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(at).map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    dayOfWeek: WEEKDAYS.indexOf(parts.weekday),
    minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute),
  };
}

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** The effective open windows (minutes since midnight) for a local date. */
function windowsFor(
  local: { date: string; dayOfWeek: number },
  hours: HoursRow[],
  overrides: OverrideRow[]
): Array<{ open: number; close: number }> {
  const override = overrides.find((o) => o.date === local.date);
  if (override) {
    if (override.closed || !override.opens || !override.closes) return [];
    return [{ open: toMinutes(override.opens), close: toMinutes(override.closes) }];
  }
  return hours
    .filter((h) => h.day_of_week === local.dayOfWeek)
    .map((h) => ({ open: toMinutes(h.opens), close: toMinutes(h.closes) }));
}

export function isOpenAt(
  at: Date,
  timeZone: string,
  hours: HoursRow[],
  overrides: OverrideRow[]
): boolean {
  const local = localParts(at, timeZone);
  return windowsFor(local, hours, overrides).some(
    (w) => local.minutes >= w.open && local.minutes < w.close
  );
}

/**
 * Pickup slots a diner can choose at checkout: every `stepMin` minutes from
 * (now + prep time) until close, across the next `days` days. The "ASAP"
 * option is separate UI — these are the scheduled choices.
 */
export function orderingSlots(
  now: Date,
  timeZone: string,
  hours: HoursRow[],
  overrides: OverrideRow[],
  prepTimeMin: number,
  days = 2,
  stepMin = 15
): Date[] {
  const slots: Date[] = [];
  const earliest = now.getTime() + prepTimeMin * 60_000;

  // Walk in stepMin increments from the top of the current hour; cheap and
  // immune to DST math because each candidate is re-localized via Intl.
  const start = new Date(now);
  start.setMinutes(Math.floor(start.getMinutes() / stepMin) * stepMin, 0, 0);

  const horizon = now.getTime() + days * 24 * 60 * 60_000;
  for (let t = start.getTime(); t <= horizon; t += stepMin * 60_000) {
    if (t < earliest) continue;
    const candidate = new Date(t);
    const local = localParts(candidate, timeZone);
    const open = windowsFor(local, hours, overrides).some(
      (w) => local.minutes >= w.open && local.minutes < w.close
    );
    if (open) slots.push(candidate);
  }
  return slots;
}
