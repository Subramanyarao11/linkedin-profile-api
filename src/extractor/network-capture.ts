import type { Page } from "playwright";

const NETWORK_PAYLOAD_LIMIT = 150;
const NETWORK_BODY_LIMIT_BYTES = 8 * 1024 * 1024;

type LinkedInNetworkCapture = {
  payloads: unknown[];
  waitForPending(): Promise<void>;
};

function isLinkedInDataUrl(url: string): boolean {
  return url.includes("linkedin.com/voyager/api/") || url.includes("linkedin.com/graphql");
}

export function captureLinkedInNetworkPayloads(page: Page): LinkedInNetworkCapture {
  const payloads: unknown[] = [];
  const pendingPayloads = new Set<Promise<void>>();

  page.on("response", (response) => {
    if (payloads.length >= NETWORK_PAYLOAD_LIMIT || !isLinkedInDataUrl(response.url())) return;

    const contentType = response.headers()["content-type"] ?? "";
    const contentLength = Number(response.headers()["content-length"] ?? 0);
    if (!contentType.includes("json") || contentLength > NETWORK_BODY_LIMIT_BYTES) return;

    let pending: Promise<void>;
    pending = response
      .json()
      .then((payload) => {
        payloads.push(payload);
      })
      .catch(() => {
        // Some successful GraphQL responses are streamed or empty; DOM fallbacks remain available.
      })
      .finally(() => pendingPayloads.delete(pending));
    pendingPayloads.add(pending);
  });

  return {
    payloads,
    async waitForPending() {
      await Promise.allSettled([...pendingPayloads]);
    }
  };
}
