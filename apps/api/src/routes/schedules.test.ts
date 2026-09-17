import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "@postpilot/db";
import { app } from "../app";

let token: string;
let postId: string;
let socialAccountId: string;

beforeEach(async () => {
  const login = await request(app).post("/auth/login").send({ password: "test-admin-password" });
  token = login.body.token;

  const media = await prisma.media.create({
    data: { url: "https://example.com/photo.jpg", type: "IMAGE", storageKey: "test/photo.jpg" },
  });
  const post = await prisma.post.create({
    data: { mediaId: media.id, fbCaption: "fb", igCaption: "ig" },
  });
  postId = post.id;

  const account = await prisma.socialAccount.create({
    data: {
      platform: "FACEBOOK",
      externalId: "page123",
      name: "Test Page",
      accessToken: "token123",
    },
  });
  socialAccountId = account.id;
});

function authed() {
  return { Authorization: `Bearer ${token}` };
}

describe("POST /schedules", () => {
  it("creates a ONE_TIME schedule targeting one social account", async () => {
    const res = await request(app)
      .post("/schedules")
      .set(authed())
      .send({
        postId,
        socialAccountIds: [socialAccountId],
        recurrenceType: "ONE_TIME",
        startAt: "2027-01-01T09:00:00.000Z",
      });

    expect(res.status).toBe(201);
    expect(res.body.schedule.postId).toBe(postId);
    expect(res.body.schedule.status).toBe("ACTIVE");
    expect(res.body.schedule.targets).toHaveLength(1);
    expect(res.body.schedule.targets[0].socialAccountId).toBe(socialAccountId);
  });

  it("requires a cronExpression for CUSTOM recurrence", async () => {
    const res = await request(app)
      .post("/schedules")
      .set(authed())
      .send({
        postId,
        socialAccountIds: [socialAccountId],
        recurrenceType: "CUSTOM",
        startAt: "2027-01-01T09:00:00.000Z",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cronExpression/);
  });

  it("returns 404 when the post doesn't exist", async () => {
    const res = await request(app)
      .post("/schedules")
      .set(authed())
      .send({
        postId: "00000000-0000-0000-0000-000000000000",
        socialAccountIds: [socialAccountId],
        recurrenceType: "ONE_TIME",
        startAt: "2027-01-01T09:00:00.000Z",
      });

    expect(res.status).toBe(404);
  });

  it("returns 404 when a target social account doesn't exist", async () => {
    const res = await request(app)
      .post("/schedules")
      .set(authed())
      .send({
        postId,
        socialAccountIds: ["00000000-0000-0000-0000-000000000000"],
        recurrenceType: "ONE_TIME",
        startAt: "2027-01-01T09:00:00.000Z",
      });

    expect(res.status).toBe(404);
  });

  it("rejects an empty socialAccountIds array", async () => {
    const res = await request(app)
      .post("/schedules")
      .set(authed())
      .send({ postId, socialAccountIds: [], recurrenceType: "ONE_TIME", startAt: "2027-01-01T09:00:00.000Z" });

    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/schedules")
      .send({
        postId,
        socialAccountIds: [socialAccountId],
        recurrenceType: "ONE_TIME",
        startAt: "2027-01-01T09:00:00.000Z",
      });

    expect(res.status).toBe(401);
  });
});

describe("GET /schedules", () => {
  it("lists schedules with their post and targets", async () => {
    await prisma.schedule.create({
      data: {
        postId,
        recurrenceType: "ONE_TIME",
        startAt: new Date("2027-01-01T09:00:00.000Z"),
        nextRunAt: new Date("2027-01-01T09:00:00.000Z"),
        targets: { create: [{ socialAccountId }] },
      },
    });

    const res = await request(app).get("/schedules").set(authed());

    expect(res.status).toBe(200);
    expect(res.body.schedules).toHaveLength(1);
    expect(res.body.schedules[0].post.id).toBe(postId);
    expect(res.body.schedules[0].targets[0].socialAccount.id).toBe(socialAccountId);
  });
});
