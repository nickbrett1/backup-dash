import { describe, expect, it } from "vitest";
import { nextRun, parseCron, zonedTimeToUtc } from "../src/lib/schedule.js";

const TZ = "America/New_York";

describe("cron parsing", () => {
  it("parses the DAG's schedule", () => {
    const cron = parseCron("30 3 * * *");
    expect([...cron.minutes]).toEqual([30]);
    expect([...cron.hours]).toEqual([3]);
  });

  it("rejects malformed expressions instead of guessing", () => {
    expect(() => parseCron("30 3 *")).toThrow();
    expect(() => parseCron("99 3 * * *")).toThrow();
  });
});

describe("next run across DST", () => {
  // 2026-11-01: clocks go back at 02:00 EDT -> 01:00 EST. 03:30 is unambiguous
  // but its UTC offset changes from -04:00 to -05:00.
  it("returns 07:30Z before the fall-back and 08:30Z after", () => {
    const before = nextRun("30 3 * * *", {
      from: new Date("2026-10-30T12:00:00Z"),
      timeZone: TZ,
    });
    expect(before.toISOString()).toBe("2026-10-31T07:30:00.000Z"); // 03:30 EDT

    const after = nextRun("30 3 * * *", {
      from: new Date("2026-11-01T12:00:00Z"),
      timeZone: TZ,
    });
    expect(after.toISOString()).toBe("2026-11-02T08:30:00.000Z"); // 03:30 EST
  });

  // 2027-03-14: clocks go forward at 02:00 EST -> 03:00 EDT.
  it("returns 08:30Z before the spring-forward and 07:30Z after", () => {
    const before = nextRun("30 3 * * *", {
      from: new Date("2027-03-12T12:00:00Z"),
      timeZone: TZ,
    });
    expect(before.toISOString()).toBe("2027-03-13T08:30:00.000Z"); // 03:30 EST

    const after = nextRun("30 3 * * *", {
      from: new Date("2027-03-14T12:00:00Z"),
      timeZone: TZ,
    });
    expect(after.toISOString()).toBe("2027-03-15T07:30:00.000Z"); // 03:30 EDT
  });

  it("lands on the correct offset on the transition day itself", () => {
    // 2026-11-01: at 02:00 the clock goes back, so 03:30 that day is already EST.
    expect(
      nextRun("30 3 * * *", {
        from: new Date("2026-10-31T12:00:00Z"),
        timeZone: TZ,
      }).toISOString(),
    ).toBe("2026-11-01T08:30:00.000Z");
    // 2027-03-14: at 02:00 the clock jumps to 03:00, so 03:30 is already EDT.
    expect(
      nextRun("30 3 * * *", {
        from: new Date("2027-03-13T12:00:00Z"),
        timeZone: TZ,
      }).toISOString(),
    ).toBe("2027-03-14T07:30:00.000Z");
  });

  it("is strictly after `from`", () => {
    const from = new Date("2026-10-24T07:30:00Z");
    const next = nextRun("30 3 * * *", { from, timeZone: TZ });
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    expect(next.toISOString()).toBe("2026-10-25T07:30:00.000Z");
  });

  it("honours day-of-week restrictions", () => {
    // Sundays at 04:00 local.
    const next = nextRun("0 4 * * 0", {
      from: new Date("2026-10-23T12:00:00Z"),
      timeZone: TZ,
    });
    expect(next.toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });
});

describe("zoned wall clock conversion", () => {
  it("maps 03:30 New York to the offset in force that day", () => {
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 10, day: 23, hour: 3, minute: 30 },
        TZ,
      ).toISOString(),
    ).toBe("2026-10-23T07:30:00.000Z");
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 12, day: 23, hour: 3, minute: 30 },
        TZ,
      ).toISOString(),
    ).toBe("2026-12-23T08:30:00.000Z");
  });
});
