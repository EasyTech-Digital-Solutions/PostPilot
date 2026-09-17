import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";

const prismaMock = vi.hoisted(() => ({
  publishHistory: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
}));

const metaClientMock = vi.hoisted(() => ({
  publishFacebookPost: vi.fn(),
  publishFacebookReel: vi.fn(),
  publishInstagramPost: vi.fn(),
}));

vi.mock("@postpilot/db", () => ({ prisma: prismaMock }));
vi.mock("./metaClient", () => ({ metaClient: metaClientMock }));

import { processPublishJob, markPublishJobFailed } from "./publishProcessor";

function historyFor(overrides: Partial<any> = {}) {
  return {
    id: "history1",
    socialAccount: {
      platform: "FACEBOOK",
      externalId: "page123",
      accessToken: "token123",
    },
    schedule: {
      post: {
        fbCaption: "FB caption",
        fbHashtags: ["promo"],
        igCaption: "IG caption",
        igHashtags: ["promo", "#already-tagged"],
        media: { url: "https://example.com/media.jpg", type: "IMAGE" },
      },
    },
    ...overrides,
  };
}

describe("processPublishJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes a Facebook photo/video post and records the external id", async () => {
    prismaMock.publishHistory.findUniqueOrThrow.mockResolvedValue(historyFor());
    metaClientMock.publishFacebookPost.mockResolvedValue({ id: "fb-post-1" });

    await processPublishJob({ data: { publishHistoryId: "history1" } } as Job<{ publishHistoryId: string }>);

    expect(metaClientMock.publishFacebookPost).toHaveBeenCalledWith("page123", "token123", {
      mediaUrl: "https://example.com/media.jpg",
      mediaType: "IMAGE",
      caption: "FB caption\n\n#promo",
    });
    expect(metaClientMock.publishFacebookReel).not.toHaveBeenCalled();
    expect(prismaMock.publishHistory.update).toHaveBeenCalledWith({
      where: { id: "history1" },
      data: { status: "SUCCESS", externalPostId: "fb-post-1", errorMessage: null },
    });
  });

  it("routes REEL media on Facebook through publishFacebookReel instead of publishFacebookPost", async () => {
    prismaMock.publishHistory.findUniqueOrThrow.mockResolvedValue(
      historyFor({
        schedule: {
          post: {
            fbCaption: "Reel caption",
            fbHashtags: [],
            igCaption: "unused",
            igHashtags: [],
            media: { url: "https://example.com/video.mp4", type: "REEL" },
          },
        },
      })
    );
    metaClientMock.publishFacebookReel.mockResolvedValue({ id: "reel-1" });

    await processPublishJob({ data: { publishHistoryId: "history1" } } as Job<{ publishHistoryId: string }>);

    expect(metaClientMock.publishFacebookReel).toHaveBeenCalledWith("page123", "token123", {
      mediaUrl: "https://example.com/video.mp4",
      mediaType: "REEL",
      caption: "Reel caption",
    });
    expect(metaClientMock.publishFacebookPost).not.toHaveBeenCalled();
  });

  it("publishes to Instagram using the post's IG caption/hashtags, not FB's", async () => {
    prismaMock.publishHistory.findUniqueOrThrow.mockResolvedValue(
      historyFor({
        socialAccount: { platform: "INSTAGRAM", externalId: "ig123", accessToken: "igtoken" },
      })
    );
    metaClientMock.publishInstagramPost.mockResolvedValue({ id: "ig-post-1" });

    await processPublishJob({ data: { publishHistoryId: "history1" } } as Job<{ publishHistoryId: string }>);

    expect(metaClientMock.publishInstagramPost).toHaveBeenCalledWith("ig123", "igtoken", {
      mediaUrl: "https://example.com/media.jpg",
      mediaType: "IMAGE",
      caption: "IG caption\n\n#promo #already-tagged",
    });
  });

  it("omits the caption/hashtag separator entirely when there are no hashtags", async () => {
    prismaMock.publishHistory.findUniqueOrThrow.mockResolvedValue(
      historyFor({
        schedule: {
          post: {
            fbCaption: "Just a caption",
            fbHashtags: [],
            igCaption: "IG caption",
            igHashtags: [],
            media: { url: "https://example.com/media.jpg", type: "IMAGE" },
          },
        },
      })
    );
    metaClientMock.publishFacebookPost.mockResolvedValue({ id: "fb-post-2" });

    await processPublishJob({ data: { publishHistoryId: "history1" } } as Job<{ publishHistoryId: string }>);

    expect(metaClientMock.publishFacebookPost).toHaveBeenCalledWith(
      "page123",
      "token123",
      expect.objectContaining({ caption: "Just a caption" })
    );
  });

  it("lets a publish failure propagate without marking the job SUCCESS", async () => {
    prismaMock.publishHistory.findUniqueOrThrow.mockResolvedValue(historyFor());
    metaClientMock.publishFacebookPost.mockRejectedValue(new Error("Meta API is down"));

    await expect(
      processPublishJob({ data: { publishHistoryId: "history1" } } as Job<{ publishHistoryId: string }>)
    ).rejects.toThrow("Meta API is down");

    expect(prismaMock.publishHistory.update).not.toHaveBeenCalled();
  });
});

describe("markPublishJobFailed", () => {
  it("records the failure status and error message", async () => {
    await markPublishJobFailed("history1", "exhausted retries");

    expect(prismaMock.publishHistory.update).toHaveBeenCalledWith({
      where: { id: "history1" },
      data: { status: "FAILED", errorMessage: "exhausted retries" },
    });
  });
});
