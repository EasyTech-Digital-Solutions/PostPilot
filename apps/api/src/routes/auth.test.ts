import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../app";

describe("POST /auth/login", () => {
  it("returns a bearer token for the correct admin password", async () => {
    const res = await request(app).post("/auth/login").send({ password: "test-admin-password" });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.length).toBeGreaterThan(10);
  });

  it("rejects an incorrect password", async () => {
    const res = await request(app).post("/auth/login").send({ password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  it("rejects a missing password", async () => {
    const res = await request(app).post("/auth/login").send({});

    expect(res.status).toBe(400);
  });

  it("issues a token that authenticates against a protected route", async () => {
    const login = await request(app).post("/auth/login").send({ password: "test-admin-password" });
    const token = login.body.token;

    const res = await request(app).get("/posts").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.posts).toEqual([]);
  });

  it("rejects a protected route with no Authorization header", async () => {
    const res = await request(app).get("/posts");
    expect(res.status).toBe(401);
  });

  it("rejects a protected route with a garbage token", async () => {
    const res = await request(app).get("/posts").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });
});
