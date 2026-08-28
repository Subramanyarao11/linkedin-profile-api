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


  it("does not report a partial cookie configuration as a session", () => {
    const config = loadConfig({
      NODE_ENV: "development",
      LINKEDIN_LI_AT: "synthetic-session-value"
    });

    expect(config.hasLinkedInSession).toBe(false);
  });

  it("enables email alerts only when the complete SMTP configuration is present", () => {
    const config = loadConfig({
      SMTP_HOST: "smtp.example.test",
      SMTP_USER: "smtp-user",
      SMTP_PASS: "smtp-password",
      SESSION_ALERT_EMAIL_FROM: "alerts@example.test",
      SESSION_ALERT_EMAIL_TO: "owner@example.test"
    });

    expect(config.sessionEmailAlertConfigured).toBe(true);
    expect(loadConfig({ SMTP_HOST: "smtp.example.test" }).sessionEmailAlertConfigured).toBe(false);
  });
});
