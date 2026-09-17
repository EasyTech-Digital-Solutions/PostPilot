import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetaGraphApiError, MetaGraphClient } from "./metaGraphClient";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("MetaGraphClient.publishFacebookReel", () => {
  const client = new MetaGraphClient({ appId: "app", appSecret: "secret" });
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits for the video to finish processing before publishing", async () => {
    let statusCalls = 0;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/video_reels") && init?.method === "POST") {
        const body = new URLSearchParams(init.body as string);
        if (body.get("upload_phase") === "start") {
          return jsonResponse({ video_id: "vid123", upload_url: "https://upload.example/vid123" });
        }
        if (body.get("upload_phase") === "finish") {
          expect(body.get("video_state")).toBe("PUBLISHED");
          return jsonResponse({ success: true });
        }
      }
      if (u.startsWith("https://upload.example/")) {
        return jsonResponse({ success: true });
      }
      if (u.includes("/vid123") && u.includes("fields=status")) {
        statusCalls += 1;
        // Not ready on the first check, ready on the second.
        return jsonResponse({ status: { video_status: statusCalls === 1 ? "processing" : "ready" } });
      }
      throw new Error(`Unexpected fetch call: ${u}`);
    });

    const resultPromise = client.publishFacebookReel("page1", "token", {
      mediaUrl: "https://example.com/video.mp4",
      mediaType: "REEL",
      caption: "hello",
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ id: "vid123" });
    expect(statusCalls).toBe(2);
  });

  it("throws without publishing if the video processing errors out", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/video_reels") && init?.method === "POST") {
        const body = new URLSearchParams(init.body as string);
        if (body.get("upload_phase") === "start") {
          return jsonResponse({ video_id: "vid123", upload_url: "https://upload.example/vid123" });
        }
        throw new Error("finish should never be called after a processing error");
      }
      if (u.startsWith("https://upload.example/")) {
        return jsonResponse({ success: true });
      }
      if (u.includes("/vid123") && u.includes("fields=status")) {
        return jsonResponse({ status: { video_status: "error" } });
      }
      throw new Error(`Unexpected fetch call: ${u}`);
    });

    const resultPromise = client.publishFacebookReel("page1", "token", {
      mediaUrl: "https://example.com/video.mp4",
      mediaType: "REEL",
      caption: "hello",
    });
    resultPromise.catch(() => {});

    await vi.runAllTimersAsync();
    await expect(resultPromise).rejects.toThrow(MetaGraphApiError);
    await expect(resultPromise).rejects.toThrow(/failed to process/);
  });

  it("times out if the video never finishes processing", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/video_reels") && init?.method === "POST") {
        const body = new URLSearchParams(init.body as string);
        if (body.get("upload_phase") === "start") {
          return jsonResponse({ video_id: "vid123", upload_url: "https://upload.example/vid123" });
        }
        throw new Error("finish should never be called on timeout");
      }
      if (u.startsWith("https://upload.example/")) {
        return jsonResponse({ success: true });
      }
      if (u.includes("/vid123") && u.includes("fields=status")) {
        return jsonResponse({ status: { video_status: "processing" } });
      }
      throw new Error(`Unexpected fetch call: ${u}`);
    });

    const resultPromise = client.publishFacebookReel("page1", "token", {
      mediaUrl: "https://example.com/video.mp4",
      mediaType: "REEL",
      caption: "hello",
    });
    resultPromise.catch(() => {});

    await vi.runAllTimersAsync();
    await expect(resultPromise).rejects.toThrow(/Timed out waiting/);
  });

  it("throws and never polls if the upload itself fails", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/video_reels") && init?.method === "POST") {
        return jsonResponse({ video_id: "vid123", upload_url: "https://upload.example/vid123" });
      }
      if (u.startsWith("https://upload.example/")) {
        return jsonResponse({ success: false, error: { message: "bad file_url" } }, false, 400);
      }
      throw new Error(`Unexpected fetch call: ${u} (polling should not happen)`);
    });

    await expect(
      client.publishFacebookReel("page1", "token", {
        mediaUrl: "https://example.com/video.mp4",
        mediaType: "REEL",
        caption: "hello",
      })
    ).rejects.toThrow(/bad file_url/);
  });
});

describe("MetaGraphClient.publishInstagramPost", () => {
  const client = new MetaGraphClient({ appId: "app", appSecret: "secret" });
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("publishes an image immediately, without polling container status", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/ig-user/media") && !u.includes("media_publish")) {
        return jsonResponse({ id: "container1" });
      }
      if (u.includes("/media_publish")) {
        return jsonResponse({ id: "published1" });
      }
      throw new Error(`Unexpected fetch call for image publish: ${u}`);
    });

    const result = await client.publishInstagramPost("ig-user", "token", {
      mediaUrl: "https://example.com/photo.jpg",
      mediaType: "IMAGE",
      caption: "hello",
    });

    expect(result).toEqual({ id: "published1" });
  });

  it("polls the container until FINISHED before publishing a reel", async () => {
    let pollCount = 0;
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/ig-user/media") && !u.includes("media_publish") && !u.includes("container1")) {
        return jsonResponse({ id: "container1" });
      }
      if (u.includes("/container1") && u.includes("status_code")) {
        pollCount += 1;
        return jsonResponse({ status_code: pollCount === 1 ? "IN_PROGRESS" : "FINISHED" });
      }
      if (u.includes("/media_publish")) {
        return jsonResponse({ id: "published1" });
      }
      throw new Error(`Unexpected fetch call for reel publish: ${u}`);
    });

    const resultPromise = client.publishInstagramPost("ig-user", "token", {
      mediaUrl: "https://example.com/video.mp4",
      mediaType: "REEL",
      caption: "hello",
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ id: "published1" });
    expect(pollCount).toBe(2);
  });

  it("throws if the container reports ERROR", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/ig-user/media") && !u.includes("media_publish") && !u.includes("container1")) {
        return jsonResponse({ id: "container1" });
      }
      if (u.includes("/container1") && u.includes("status_code")) {
        return jsonResponse({ status_code: "ERROR" });
      }
      throw new Error(`Unexpected fetch call: ${u} (should not publish after ERROR)`);
    });

    const resultPromise = client.publishInstagramPost("ig-user", "token", {
      mediaUrl: "https://example.com/video.mp4",
      mediaType: "VIDEO",
      caption: "hello",
    });
    resultPromise.catch(() => {});

    await vi.runAllTimersAsync();
    await expect(resultPromise).rejects.toThrow(/failed to process/);
  });
});
