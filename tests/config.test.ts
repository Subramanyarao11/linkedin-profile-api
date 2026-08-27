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

  it("recognizes a local Playwright storage-state path as a session", () => {
    const config = loadConfig({
      NODE_ENV: "development",
      LINKEDIN_STORAGE_STATE_PATH: "storage-state.json"
    });

    expect(config.hasLinkedInSession).toBe(true);
    expect(config.LINKEDIN_STORAGE_STATE_PATH).toBe("storage-state.json");
  });

  it("recognizes a read-only secret seed file as a session", () => {
    const config = loadConfig({
      NODE_ENV: "development",
      LINKEDIN_STORAGE_STATE_SEED_PATH: "/etc/secrets/storage-state.json"
    });

    expect(config.hasLinkedInSession).toBe(true);
  });
});
