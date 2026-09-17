const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export class MetaGraphApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown
  ) {
    super(message);
    this.name = "MetaGraphApiError";
  }
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

export interface PublishParams {
  mediaUrl: string;
  mediaType: "IMAGE" | "VIDEO" | "REEL";
  caption: string;
}

export interface MetaGraphClientConfig {
  appId: string;
  appSecret: string;
}

async function graphFetch<T>(
  path: string,
  params: Record<string, string>,
  method: "GET" | "POST" = "GET"
): Promise<T> {
  const url = new URL(`${GRAPH_BASE_URL}${path}`);
  const init: RequestInit = { method };

  if (method === "GET") {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  } else {
    const body = new URLSearchParams(params);
    init.body = body;
  }

  const response = await fetch(url.toString(), init);
  const json = (await response.json()) as any;

  if (!response.ok || json?.error) {
    throw new MetaGraphApiError(
      json?.error?.message ?? `Meta Graph API request failed (${response.status})`,
      response.status,
      json
    );
  }

  return json as T;
}

export class MetaGraphClient {
  constructor(private readonly config: MetaGraphClientConfig) {}

  /** Step 1 of Meta OAuth: exchange the ?code= from the redirect for a short-lived user token. */
  async exchangeCodeForToken(
    code: string,
    redirectUri: string
  ): Promise<{ access_token: string; token_type: string; expires_in?: number }> {
    return graphFetch("/oauth/access_token", {
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      redirect_uri: redirectUri,
      code,
    });
  }

  /** Exchanges a short-lived user token for a long-lived one (~60 days). */
  async getLongLivedUserToken(
    shortLivedToken: string
  ): Promise<{ access_token: string; token_type: string; expires_in?: number }> {
    return graphFetch("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: this.config.appId,
      client_secret: this.config.appSecret,
      fb_exchange_token: shortLivedToken,
    });
  }

  /**
   * Lists the Facebook Pages the user manages, including each page's own
   * (non-expiring while the user token is valid) access token and its
   * linked Instagram Professional account, if any.
   */
  async getManagedPages(userAccessToken: string): Promise<MetaPage[]> {
    const result = await graphFetch<{ data: MetaPage[] }>("/me/accounts", {
      access_token: userAccessToken,
      fields: "id,name,access_token,instagram_business_account",
    });
    return result.data;
  }

  /** Publishes a photo or a plain (non-Reel) video post to a Facebook Page. */
  async publishFacebookPost(
    pageId: string,
    pageAccessToken: string,
    params: PublishParams
  ): Promise<{ id: string }> {
    if (params.mediaType === "IMAGE") {
      return graphFetch(
        `/${pageId}/photos`,
        {
          url: params.mediaUrl,
          caption: params.caption,
          access_token: pageAccessToken,
        },
        "POST"
      );
    }

    return graphFetch(
      `/${pageId}/videos`,
      {
        file_url: params.mediaUrl,
        description: params.caption,
        access_token: pageAccessToken,
      },
      "POST"
    );
  }

  /**
   * Publishes a Facebook Reel via Meta's resumable Video Reels API, using
   * the hosted-file variant (Meta fetches `mediaUrl` itself) since our
   * media is always already public -- no byte upload needed on our end.
   *
   * NOTE: this endpoint's exact field/response shape is implemented from
   * documentation, not verified against a live Page in this environment.
   * If Meta's actual response differs, this is the one function to patch.
   */
  async publishFacebookReel(
    pageId: string,
    pageAccessToken: string,
    params: PublishParams
  ): Promise<{ id: string }> {
    const start = await graphFetch<{ video_id: string; upload_url: string }>(
      `/${pageId}/video_reels`,
      { upload_phase: "start", access_token: pageAccessToken },
      "POST"
    );

    const uploadResponse = await fetch(start.upload_url, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${pageAccessToken}`,
        file_url: params.mediaUrl,
      },
    });
    const uploadJson = (await uploadResponse.json().catch(() => ({}))) as any;
    if (!uploadResponse.ok || uploadJson?.success === false) {
      throw new MetaGraphApiError(
        uploadJson?.error?.message ?? `Facebook Reel upload failed (${uploadResponse.status})`,
        uploadResponse.status,
        uploadJson
      );
    }

    await this.waitForVideoReady(start.video_id, pageAccessToken);

    await graphFetch(
      `/${pageId}/video_reels`,
      {
        upload_phase: "finish",
        video_id: start.video_id,
        video_state: "PUBLISHED",
        description: params.caption,
        access_token: pageAccessToken,
      },
      "POST"
    );

    return { id: start.video_id };
  }

  /**
   * Publishes to an Instagram Professional account using the two-step
   * container flow: create a media container, poll until Meta finishes
   * processing it, then publish the container.
   */
  async publishInstagramPost(
    igUserId: string,
    accessToken: string,
    params: PublishParams
  ): Promise<{ id: string }> {
    const containerParams: Record<string, string> = {
      caption: params.caption,
      access_token: accessToken,
    };

    if (params.mediaType === "IMAGE") {
      containerParams.image_url = params.mediaUrl;
    } else {
      containerParams.video_url = params.mediaUrl;
      if (params.mediaType === "REEL") {
        containerParams.media_type = "REELS";
      }
    }

    const container = await graphFetch<{ id: string }>(
      `/${igUserId}/media`,
      containerParams,
      "POST"
    );

    if (params.mediaType !== "IMAGE") {
      await this.waitForContainerReady(container.id, accessToken);
    }

    return graphFetch(
      `/${igUserId}/media_publish`,
      { creation_id: container.id, access_token: accessToken },
      "POST"
    );
  }

  /** Polls a Facebook video (including a Reel's hosted-file upload) until Meta finishes processing it. */
  private async waitForVideoReady(
    videoId: string,
    accessToken: string,
    { maxAttempts = 20, delayMs = 3000 } = {}
  ): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const result = await graphFetch<{ status: { video_status: string } }>(`/${videoId}`, {
        fields: "status",
        access_token: accessToken,
      });

      const videoStatus = result.status?.video_status;
      if (videoStatus === "ready") return;
      if (videoStatus === "error") {
        throw new MetaGraphApiError("Facebook video failed to process", 502, result);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new MetaGraphApiError(
      "Timed out waiting for Facebook video to finish processing",
      504,
      { videoId }
    );
  }

  /** Polls an Instagram media container until Meta has finished processing the video/reel. */
  private async waitForContainerReady(
    containerId: string,
    accessToken: string,
    { maxAttempts = 20, delayMs = 3000 } = {}
  ): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const status = await graphFetch<{ status_code: string }>(`/${containerId}`, {
        fields: "status_code",
        access_token: accessToken,
      });

      if (status.status_code === "FINISHED") return;
      if (status.status_code === "ERROR") {
        throw new MetaGraphApiError(
          "Instagram media container failed to process",
          502,
          status
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new MetaGraphApiError(
      "Timed out waiting for Instagram media container to finish processing",
      504,
      { containerId }
    );
  }
}
