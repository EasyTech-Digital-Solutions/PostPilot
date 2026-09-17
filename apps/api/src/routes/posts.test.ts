import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "@postpilot/db";
import { app } from "../app";

let token: string;
let mediaId: string;

beforeEach(async () => {
  const login = await request(app).post("/auth/login").send({ password: "test-admin-password" });
  token = login.body.token;

  const media = await prisma.media.create({
    data: { url: "https://example.com/photo.jpg", type: "IMAGE", storageKey: "test/photo.jpg" },
  });
  mediaId = media.id;
});

function authed() {
  return { Authorization: `Bearer ${token}` };
}

describe("POST /posts", () => {
  it("creates a post with separate Facebook/Instagram captions", async () => {
    // Regression test: an earlier environment drift (an untracked
    // post_variants migration) silently dropped these columns from the
    // posts table, and this endpoint crashed the whole process on the
    // resulting Prisma error. See migrations/20260916000000_reconcile_post_captions.
    const res = await request(app)
      .post("/posts")
      .set(authed())
      .send({
        mediaId,
        label: "Launch announcement",
        fbCaption: "FB caption",
        fbHashtags: ["launch"],
        igCaption: "IG caption",
        igHashtags: ["launch", "new"],
      });

    expect(res.status).toBe(201);
    expect(res.body.post).toMatchObject({
      mediaId,
      label: "Launch announcement",
      fbCaption: "FB caption",
      fbHashtags: ["launch"],
      igCaption: "IG caption",
      igHashtags: ["launch", "new"],
    });
    expect(res.body.post.media.id).toBe(mediaId);
  });

  it("rejects a payload missing required captions", async () => {
    const res = await request(app).post("/posts").set(authed()).send({ mediaId });
    expect(res.status).toBe(400);
  });

  it("returns 404 when mediaId doesn't reference an existing media row", async () => {
    const res = await request(app)
      .post("/posts")
      .set(authed())
      .send({
        mediaId: "00000000-0000-0000-0000-000000000000",
        fbCaption: "x",
        igCaption: "x",
      });

    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/posts").send({ mediaId, fbCaption: "x", igCaption: "x" });
    expect(res.status).toBe(401);
  });
});

describe("GET /posts and /posts/:id", () => {
  it("lists posts newest first", async () => {
    const first = await prisma.post.create({
      data: { mediaId, fbCaption: "first", igCaption: "first" },
    });
    const second = await prisma.post.create({
      data: { mediaId, fbCaption: "second", igCaption: "second" },
    });

    const res = await request(app).get("/posts").set(authed());

    expect(res.status).toBe(200);
    expect(res.body.posts.map((p: any) => p.id)).toEqual([second.id, first.id]);
  });

  it("fetches a single post with its media and schedules", async () => {
    const post = await prisma.post.create({
      data: { mediaId, fbCaption: "a", igCaption: "a" },
    });

    const res = await request(app).get(`/posts/${post.id}`).set(authed());

    expect(res.status).toBe(200);
    expect(res.body.post.id).toBe(post.id);
    expect(res.body.post.media.id).toBe(mediaId);
    expect(res.body.post.schedules).toEqual([]);
  });

  it("returns 404 for a nonexistent post id", async () => {
    const res = await request(app).get("/posts/does-not-exist").set(authed());
    expect(res.status).toBe(404);
  });
});

describe("PUT /posts/:id", () => {
  it("partially updates a post", async () => {
    const post = await prisma.post.create({
      data: { mediaId, fbCaption: "old fb", igCaption: "old ig" },
    });

    const res = await request(app)
      .put(`/posts/${post.id}`)
      .set(authed())
      .send({ fbCaption: "new fb" });

    expect(res.status).toBe(200);
    expect(res.body.post.fbCaption).toBe("new fb");
    expect(res.body.post.igCaption).toBe("old ig");
  });

  it("returns 404 when updating a nonexistent post", async () => {
    const res = await request(app).put("/posts/does-not-exist").set(authed()).send({ fbCaption: "x" });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /posts/:id", () => {
  it("deletes an existing post", async () => {
    const post = await prisma.post.create({
      data: { mediaId, fbCaption: "a", igCaption: "a" },
    });

    const res = await request(app).delete(`/posts/${post.id}`).set(authed());
    expect(res.status).toBe(204);

    const found = await prisma.post.findUnique({ where: { id: post.id } });
    expect(found).toBeNull();
  });

  it("returns 404 when deleting a nonexistent post", async () => {
    const res = await request(app).delete("/posts/does-not-exist").set(authed());
    expect(res.status).toBe(404);
  });
});
