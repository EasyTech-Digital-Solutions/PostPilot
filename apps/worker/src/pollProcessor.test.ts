import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Queue } from "bullmq";

const prismaMock = vi.hoisted(() => ({
  schedule: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  publishHistory: {
    create: vi.fn(),
  },
}));

vi.mock("@postpilot/db", () => ({ prisma: prismaMock }));

import { processDueSchedules } from "./pollProcessor";

function fakeQueue() {
  return { add: vi.fn() } as unknown as Queue;
}

describe("processDueSchedules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.publishHistory.create.mockImplementation(async ({ data }: any) => ({
      id: `history-${data.socialAccountId}`,
      ...data,
    }));
  });

  it("does nothing when no schedules are due", async () => {
    prismaMock.schedule.findMany.mockResolvedValue([]);
    const queue = fakeQueue();

    const count = await processDueSchedules(queue);

    expect(count).toBe(0);
    expect(prismaMock.schedule.update).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("completes a ONE_TIME schedule and enqueues one job per target", async () => {
    prismaMock.schedule.findMany.mockResolvedValue([
      {
        id: "sched1",
        recurrenceType: "ONE_TIME",
        interval: 1,
        cronExpression: null,
        timezone: "UTC",
        nextRunAt: new Date("2026-01-01T09:00:00.000Z"),
        endAt: null,
        targets: [
          { socialAccountId: "acct-fb", socialAccount: { id: "acct-fb", platform: "FACEBOOK" } },
          { socialAccountId: "acct-ig", socialAccount: { id: "acct-ig", platform: "INSTAGRAM" } },
        ],
      },
    ]);
    const queue = fakeQueue();

    const count = await processDueSchedules(queue);

    expect(count).toBe(1);
    expect(prismaMock.schedule.update).toHaveBeenCalledWith({
      where: { id: "sched1" },
      data: { nextRunAt: null, status: "COMPLETED" },
    });
    expect(prismaMock.publishHistory.create).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(
      "publish",
      { publishHistoryId: "history-acct-fb" },
      expect.objectContaining({ attempts: 2 })
    );
  });

  it("advances a recurring schedule's nextRunAt and keeps it ACTIVE", async () => {
    prismaMock.schedule.findMany.mockResolvedValue([
      {
        id: "sched2",
        recurrenceType: "DAILY",
        interval: 1,
        cronExpression: null,
        timezone: "UTC",
        nextRunAt: new Date("2026-01-01T09:00:00.000Z"),
        endAt: null,
        targets: [{ socialAccountId: "acct-fb", socialAccount: { id: "acct-fb", platform: "FACEBOOK" } }],
      },
    ]);
    const queue = fakeQueue();

    await processDueSchedules(queue);

    expect(prismaMock.schedule.update).toHaveBeenCalledWith({
      where: { id: "sched2" },
      data: { nextRunAt: new Date("2026-01-02T09:00:00.000Z"), status: "ACTIVE" },
    });
  });

  it("completes a recurring schedule once its next occurrence would pass endAt", async () => {
    prismaMock.schedule.findMany.mockResolvedValue([
      {
        id: "sched3",
        recurrenceType: "DAILY",
        interval: 1,
        cronExpression: null,
        timezone: "UTC",
        nextRunAt: new Date("2026-01-01T09:00:00.000Z"),
        endAt: new Date("2026-01-01T12:00:00.000Z"), // next daily occurrence (Jan 2) is past this
        targets: [{ socialAccountId: "acct-fb", socialAccount: { id: "acct-fb", platform: "FACEBOOK" } }],
      },
    ]);
    const queue = fakeQueue();

    await processDueSchedules(queue);

    expect(prismaMock.schedule.update).toHaveBeenCalledWith({
      where: { id: "sched3" },
      data: { nextRunAt: null, status: "COMPLETED" },
    });
  });

  it("creates each publishHistory row as PENDING with the schedule's due runAt", async () => {
    const dueAt = new Date("2026-01-01T09:00:00.000Z");
    prismaMock.schedule.findMany.mockResolvedValue([
      {
        id: "sched4",
        recurrenceType: "ONE_TIME",
        interval: 1,
        cronExpression: null,
        timezone: "UTC",
        nextRunAt: dueAt,
        endAt: null,
        targets: [{ socialAccountId: "acct-fb", socialAccount: { id: "acct-fb", platform: "FACEBOOK" } }],
      },
    ]);
    const queue = fakeQueue();

    await processDueSchedules(queue);

    expect(prismaMock.publishHistory.create).toHaveBeenCalledWith({
      data: {
        scheduleId: "sched4",
        socialAccountId: "acct-fb",
        platform: "FACEBOOK",
        status: "PENDING",
        runAt: dueAt,
      },
    });
  });
});
