import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { addWallClockDays, computeNextRunAt, nextWeekdayAt } from "./recurrence";

describe("computeNextRunAt", () => {
  it("returns null for ONE_TIME (no further occurrences)", () => {
    const result = computeNextRunAt(
      { recurrenceType: "ONE_TIME", interval: 1, timezone: "UTC" },
      new Date("2026-01-01T09:00:00.000Z")
    );
    expect(result).toBeNull();
  });

  it("advances DAILY by the given interval in whole days", () => {
    const result = computeNextRunAt(
      { recurrenceType: "DAILY", interval: 3, timezone: "UTC" },
      new Date("2026-01-01T09:00:00.000Z")
    );
    expect(result?.toISOString()).toBe("2026-01-04T09:00:00.000Z");
  });

  it("defaults DAILY interval to 1 when not set", () => {
    const result = computeNextRunAt(
      { recurrenceType: "DAILY", interval: 0, timezone: "UTC" },
      new Date("2026-01-01T09:00:00.000Z")
    );
    expect(result?.toISOString()).toBe("2026-01-02T09:00:00.000Z");
  });

  it("advances WEEKLY by 7 * interval days", () => {
    const result = computeNextRunAt(
      { recurrenceType: "WEEKLY", interval: 2, timezone: "UTC" },
      new Date("2026-01-01T09:00:00.000Z")
    );
    expect(result?.toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("advances BIWEEKLY by exactly 14 days regardless of interval", () => {
    const result = computeNextRunAt(
      { recurrenceType: "BIWEEKLY", interval: 5, timezone: "UTC" },
      new Date("2026-01-01T09:00:00.000Z")
    );
    expect(result?.toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("advances MONTHLY by calendar months, preserving local time", () => {
    const result = computeNextRunAt(
      { recurrenceType: "MONTHLY", interval: 1, timezone: "UTC" },
      new Date("2026-01-15T09:00:00.000Z")
    );
    expect(result?.toISOString()).toBe("2026-02-15T09:00:00.000Z");
  });

  it("clamps MONTHLY to the shorter month's last day instead of overflowing", () => {
    // Jan 31 + 1 month must land on Feb 28 (2026 is not a leap year), not March 3.
    const result = computeNextRunAt(
      { recurrenceType: "MONTHLY", interval: 1, timezone: "UTC" },
      new Date("2026-01-31T09:00:00.000Z")
    );
    expect(result?.toISOString()).toBe("2026-02-28T09:00:00.000Z");
  });

  it("computes CUSTOM occurrences from a cron expression", () => {
    const result = computeNextRunAt(
      {
        recurrenceType: "CUSTOM",
        interval: 1,
        timezone: "UTC",
        cronExpression: "0 9 * * MON",
      },
      new Date("2026-01-01T09:00:00.000Z") // a Thursday
    );
    // Next Monday after Thu Jan 1 2026 is Jan 5 2026.
    expect(result?.toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });

  it("throws for CUSTOM recurrence with no cronExpression", () => {
    expect(() =>
      computeNextRunAt(
        { recurrenceType: "CUSTOM", interval: 1, timezone: "UTC" },
        new Date("2026-01-01T09:00:00.000Z")
      )
    ).toThrow(/cronExpression/);
  });

  it("throws for an unknown recurrence type", () => {
    expect(() =>
      computeNextRunAt(
        // @ts-expect-error deliberately invalid for this test
        { recurrenceType: "YEARLY", interval: 1, timezone: "UTC" },
        new Date("2026-01-01T09:00:00.000Z")
      )
    ).toThrow(/Unknown recurrence type/);
  });
});

describe("addWallClockDays (DST safety)", () => {
  it("keeps the same local wall-clock hour across a DST spring-forward transition", () => {
    // America/New_York springs forward on 2026-03-08 (2am -> 3am).
    // 9am local on Mar 7 + 1 day must still land on 9am local on Mar 8,
    // even though that's only a 23-hour real-time gap.
    const before = DateTime.fromISO("2026-03-07T09:00:00", {
      zone: "America/New_York",
    }).toJSDate();

    const result = addWallClockDays(before, "America/New_York", 1);
    const resultLocal = DateTime.fromJSDate(result, { zone: "America/New_York" });

    expect(resultLocal.hour).toBe(9);
    expect(resultLocal.day).toBe(8);
  });

  it("keeps the same local wall-clock hour across a DST fall-back transition", () => {
    // America/New_York falls back on 2026-11-01 (2am -> 1am), a 25-hour day.
    const before = DateTime.fromISO("2026-10-31T09:00:00", {
      zone: "America/New_York",
    }).toJSDate();

    const result = addWallClockDays(before, "America/New_York", 1);
    const resultLocal = DateTime.fromJSDate(result, { zone: "America/New_York" });

    expect(resultLocal.hour).toBe(9);
    expect(resultLocal.day).toBe(1);
    expect(resultLocal.month).toBe(11);
  });
});

describe("nextWeekdayAt", () => {
  it("returns today when the target weekday/time hasn't passed yet", () => {
    // 2026-01-05 is a Monday (luxon weekday 1).
    const from = new Date("2026-01-05T08:00:00.000Z");
    const result = nextWeekdayAt("UTC", 1, 9, 0, from);
    expect(result.toISOString()).toBe("2026-01-05T09:00:00.000Z");
  });

  it("rolls over to next week when today's target time has already passed", () => {
    const from = new Date("2026-01-05T10:00:00.000Z"); // Monday 10am, past the 9am target
    const result = nextWeekdayAt("UTC", 1, 9, 0, from);
    expect(result.toISOString()).toBe("2026-01-12T09:00:00.000Z");
  });

  it("finds the next occurrence of a different weekday", () => {
    const from = new Date("2026-01-05T08:00:00.000Z"); // Monday
    const result = nextWeekdayAt("UTC", 5, 9, 0, from); // next Friday
    expect(result.toISOString()).toBe("2026-01-09T09:00:00.000Z");
  });
});
