import { describe, expect, it } from "vitest";
import { InvalidProfileUrlError, normalizeLinkedInProfileUrl } from "../src/profile-url.js";

describe("normalizeLinkedInProfileUrl", () => {
  it("canonicalizes country subdomains and removes tracking parameters", () => {
    expect(
      normalizeLinkedInProfileUrl("https://in.linkedin.com/in/demo-person/?trk=public_profile")
    ).toEqual({
      publicIdentifier: "demo-person",
      url: "https://www.linkedin.com/in/demo-person/"
    });
  });

  it.each([
    "http://www.linkedin.com/in/demo-person/",
    "https://linkedin.example.com/in/demo-person/",
    "https://www.linkedin.com/company/example/",
    "not a url"
  ])("rejects unsafe or non-profile input: %s", (input) => {
    expect(() => normalizeLinkedInProfileUrl(input)).toThrow(InvalidProfileUrlError);
  });
});
