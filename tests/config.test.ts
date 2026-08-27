import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("allows a public production demo without an evaluator key", () => {
    const config = loadConfig({ NODE_ENV: "production" });

    expect(config.API_ACCESS_MODE).toBe("public");
    expect(config.apiKeys).toEqual([]);
  });

  it("requires keys when API-key access mode is selected", () => {
    expect(() => loadConfig({ API_ACCESS_MODE: "api-key" })).toThrow(
      "API_KEYS must contain at least one key when API_ACCESS_MODE=api-key"
    );
  });

  it("parses rotated keys and a LinkedIn session without exposing its value", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      API_ACCESS_MODE: "api-key",
      API_KEYS: " first-key, second-key ",
      LINKEDIN_LI_AT: "synthetic-session-value",
      LINKEDIN_JSESSIONID: '"ajax:synthetic"'
    });

    expect(config.apiKeys).toEqual(["first-key", "second-key"]);
    expect(config.hasLinkedInSession).toBe(true);
  });

  it("enables visible detail pages by default", () => {
    expect(loadConfig({}).INCLUDE_DETAIL_PAGES).toBe(true);
    expect(loadConfig({ INCLUDE_DETAIL_PAGES: "false" }).INCLUDE_DETAIL_PAGES).toBe(false);
  });

  it("does not report a partial cookie configuration as a session", () => {
    const config = loadConfig({
      NODE_ENV: "development",
      LINKEDIN_LI_AT: "synthetic-session-value"
    });

    expect(config.hasLinkedInSession).toBe(false);
  });
});
