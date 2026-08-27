import type { ScrapeErrorCode } from "../errors.js";

export type BlockedPage = {
  code: ScrapeErrorCode;
  message: string;
  statusCode: number;
};

export function classifyBlockedPage(url: string, bodyText = ""): BlockedPage | null {
  const path = new URL(url).pathname.toLowerCase();
  const visibleText = bodyText.toLowerCase();

  if (
    /\/checkpoint\/(challenge|lg)\b/.test(path) ||
    visibleText.includes("security verification") ||
    visibleText.includes("verify your identity")
  ) {
    return {
      code: "challenge_required",
      message:
        "LinkedIn requires an interactive checkpoint. Refresh the session manually; this service does not bypass challenges.",
      statusCode: 503
    };
  }

  if (/\/(login|authwall|signup)\b/.test(path)) {
    return {
      code: "authentication_required",
      message: "The configured LinkedIn session is missing or expired.",
      statusCode: 503
    };
  }

  return null;
}
