import { describe, expect, it } from "vitest";
import { classifyBlockedPage } from "../src/extractor/page-state.js";

describe("classifyBlockedPage", () => {
  it("recognizes LinkedIn checkpoints from the URL", () => {
    expect(classifyBlockedPage("https://www.linkedin.com/checkpoint/challenge/123")?.code).toBe(
      "challenge_required"
    );
  });

  it("recognizes a security verification page after a client-side redirect", () => {
    expect(
      classifyBlockedPage("https://www.linkedin.com/signup/cold-join", "Security verification")?.code
    ).toBe("challenge_required");
  });

  it.each(["login", "authwall", "signup"])("recognizes the %s route as unauthenticated", (route) => {
    expect(classifyBlockedPage(`https://www.linkedin.com/${route}`)?.code).toBe(
      "authentication_required"
    );
  });

  it("allows a normal profile page", () => {
    expect(classifyBlockedPage("https://www.linkedin.com/in/demo-person/", "Demo Person")).toBeNull();
  });
});
