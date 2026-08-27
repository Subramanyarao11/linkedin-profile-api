import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("requires API-key protection in production", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(
      "API_KEYS must contain at least one key in production"
    );
  });

  it("parses rotated keys and a LinkedIn session without exposing its value", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      API_KEYS: " first-key, second-key ",
      LINKEDIN_LI_AT: "synthetic-session-value"
    });

    expect(config.apiKeys).toEqual(["first-key", "second-key"]);
    expect(config.hasLinkedInSession).toBe(true);
  });
});
