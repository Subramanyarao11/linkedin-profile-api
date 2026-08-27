export type NormalizedProfileUrl = {
  url: string;
  publicIdentifier: string;
};

export class InvalidProfileUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProfileUrlError";
  }
}

export function normalizeLinkedInProfileUrl(input: string): NormalizedProfileUrl {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    throw new InvalidProfileUrlError("url must be an absolute LinkedIn profile URL");
  }

  if (parsed.protocol !== "https:") {
    throw new InvalidProfileUrlError("url must use HTTPS");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "linkedin.com" && !hostname.endsWith(".linkedin.com")) {
    throw new InvalidProfileUrlError("url host must be linkedin.com");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() !== "in" || !segments[1]) {
    throw new InvalidProfileUrlError("url must point to a LinkedIn /in/{publicIdentifier} profile");
  }

  let publicIdentifier: string;
  try {
    publicIdentifier = decodeURIComponent(segments[1]);
  } catch {
    throw new InvalidProfileUrlError("profile identifier is not valid URL encoding");
  }

  if (!/^[\p{L}\p{N}_-]{2,120}$/u.test(publicIdentifier)) {
    throw new InvalidProfileUrlError("profile identifier contains unsupported characters");
  }

  const encoded = encodeURIComponent(publicIdentifier);
  return {
    publicIdentifier,
    url: `https://www.linkedin.com/in/${encoded}/`
  };
}
