// Cron parsing and next-run computation in the DAG's timezone.
//
// The naive version of this — `new Date(..., 30, 3)` in server-local time, or
// converting a UTC instant back with a fixed offset — is wrong twice a year and
// fails silently. So: cron fields are matched against *wall clock* components
// in the target zone, and each resulting wall-clock time is converted to an
// instant using the offset that actually applies on that date.

const DAY_MS = 86_400_000;

function parseField(field, min, max) {
  const values = new Set();
  for (const part of field.split(",")) {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw === undefined ? 1 : Number.parseInt(stepRaw, 10);
    if (!Number.isFinite(step) || step < 1)
      throw new Error(`bad step in cron field "${field}"`);

    let lo;
    let hi;
    if (range === "*") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b] = range.split("-").map((n) => Number.parseInt(n, 10));
      lo = a;
      hi = b;
    } else {
      lo = Number.parseInt(range, 10);
      hi = range === "" ? NaN : lo;
    }
    if (
      !Number.isFinite(lo) ||
      !Number.isFinite(hi) ||
      lo < min ||
      hi > max ||
      hi < lo
    ) {
      throw new Error(`bad value in cron field "${field}"`);
    }
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values;
}

/** Parse a 5-field cron expression. Unsupported syntax throws rather than guessing. */
export function parseCron(expression) {
  const fields = String(expression).trim().split(/\s+/);
  if (fields.length !== 5)
    throw new Error(`expected 5 cron fields, got ${fields.length}`);
  const [minute, hour, dom, month, dow] = fields;
  return {
    minutes: parseField(minute, 0, 59),
    hours: parseField(hour, 0, 23),
    daysOfMonth: parseField(dom, 1, 31),
    months: parseField(month, 1, 12),
    // Cron: 0 and 7 are both Sunday.
    daysOfWeek: new Set(
      [...parseField(dow, 0, 7)].map((d) => (d === 7 ? 0 : d)),
    ),
    domRestricted: dom !== "*",
    dowRestricted: dow !== "*",
  };
}

function parts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out = {};
  for (const { type, value } of formatter.formatToParts(date)) {
    if (type !== "literal") out[type] = Number.parseInt(value, 10);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour,
    minute: out.minute,
    second: out.second,
  };
}

function offsetMs(date, timeZone) {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return asUtc - date.getTime();
}

/** Convert a wall-clock time in `timeZone` to a UTC instant. */
export function zonedTimeToUtc(
  { year, month, day, hour = 0, minute = 0 },
  timeZone,
) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = guess - offsetMs(new Date(guess), timeZone);
  // One refinement handles the offset changing between the guess and the
  // result (the day of a DST transition).
  instant = guess - offsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

/**
 * Next occurrence strictly after `from`.
 * @param {string|ReturnType<typeof parseCron>} cron
 */
export function nextRun(
  cron,
  { from = new Date(), timeZone = "America/New_York" } = {},
) {
  const parsed = typeof cron === "string" ? parseCron(cron) : cron;
  const hours = [...parsed.hours].sort((a, b) => a - b);
  const minutes = [...parsed.minutes].sort((a, b) => a - b);
  const fromMs = from.getTime();
  const start = parts(from, timeZone);

  for (let dayOffset = 0; dayOffset <= 400; dayOffset += 1) {
    const cursor = new Date(
      Date.UTC(start.year, start.month - 1, start.day) + dayOffset * DAY_MS,
    );
    const date = {
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
      day: cursor.getUTCDate(),
    };
    const weekday = new Date(
      Date.UTC(date.year, date.month - 1, date.day),
    ).getUTCDay();

    if (!parsed.months.has(date.month)) continue;
    const domHit = parsed.daysOfMonth.has(date.day);
    const dowHit = parsed.daysOfWeek.has(weekday);
    // Standard cron: when both day-of-month and day-of-week are restricted,
    // either matching is enough.
    const dayHit =
      parsed.domRestricted && parsed.dowRestricted
        ? domHit || dowHit
        : parsed.domRestricted
          ? domHit
          : parsed.dowRestricted
            ? dowHit
            : true;
    if (!dayHit) continue;

    for (const hour of hours) {
      for (const minute of minutes) {
        const instant = zonedTimeToUtc({ ...date, hour, minute }, timeZone);
        if (instant.getTime() > fromMs) return instant;
      }
    }
  }
  throw new Error("no next run within 400 days");
}

const DISPLAY = (timeZone) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  });

export function formatInZone(date, timeZone) {
  if (!date) return null;
  return DISPLAY(timeZone).format(date);
}

export function formatAge(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds))
    return null;
  const s = Math.max(0, Math.round(seconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours >= 48) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
