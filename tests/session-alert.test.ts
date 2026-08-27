import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { EmailSessionAlert } from "../src/session-alert.js";

function alertConfig() {
  return loadConfig({
    NODE_ENV: "test",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_SECURE: "false",
    SMTP_USER: "smtp-user",
    SMTP_PASS: "smtp-password",
    SESSION_ALERT_EMAIL_FROM: "alerts@example.test",
    SESSION_ALERT_EMAIL_TO: "owner@example.test",
    SESSION_ALERT_COOLDOWN_SECONDS: "3600",
    SERVICE_PUBLIC_URL: "https://api.example.test"
  });
}

describe("EmailSessionAlert", () => {
  it("sends a non-sensitive recovery email and deduplicates repeated failures", async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: ["owner@example.test"] });
    const alert = new EmailSessionAlert(alertConfig(), { sendMail }, () => 1_777_777_777_000);

    const first = await alert.notify({
      reason: "authentication_required",
      source: "profile_extraction"
    });
    const second = await alert.notify({
      reason: "authentication_required",
      source: "readiness_check"
    });

    expect(first).toBe("sent");
    expect(second).toBe("cooldown");
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({
      from: "alerts@example.test",
      to: "owner@example.test",
      subject: expect.stringContaining("Session needs attention"),
      text: expect.stringContaining("No LinkedIn cookies or requested profile URLs")
    }));
    expect(JSON.stringify(sendMail.mock.calls)).not.toContain("smtp-password");
  });

  it("does nothing when SMTP is not configured", async () => {
    const sendMail = vi.fn();
    const alert = new EmailSessionAlert(loadConfig({ NODE_ENV: "test" }), { sendMail });

    await expect(alert.notify({
      reason: "challenge_required",
      source: "readiness_check"
    })).resolves.toBe("disabled");
    expect(sendMail).not.toHaveBeenCalled();
  });
});
