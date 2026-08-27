export type ScrapeErrorCode =
  | "authentication_required"
  | "challenge_required"
  | "profile_not_found"
  | "profile_unavailable"
  | "scrape_timeout"
  | "extraction_failed";

export class ScrapeError extends Error {
  constructor(
    public readonly code: ScrapeErrorCode,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = "ScrapeError";
  }
}
