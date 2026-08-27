import nodemailer, { type SendMailOptions } from "nodemailer";
import type { AppConfig } from "./config.js";

export type SessionAlertReason = "authentication_required" | "challenge_required";
export type SessionAlertSource = "profile_extraction" | "readiness_check";

export type SessionAlertInput = {
  reason: SessionAlertReason;
  source: SessionAlertSource;
};

export type SessionAlertOutcome = "sent" | "cooldown" | "disabled";

export type SessionAlertService = {
  notify(input: SessionAlertInput): Promise<SessionAlertOutcome>;
};

type MailSender = {
  sendMail(options: SendMailOptions): Promise<unknown>;
};

export class EmailSessionAlert implements SessionAlertService {
  private readonly sender: MailSender | undefined;
  private nextAllowedAt = 0;

  constructor(
    private readonly config: AppConfig,
    sender?: MailSender,
    private readonly now: () => number = Date.now
  ) {
    this.sender = sender ?? this.createSender();
  }

  async notify(input: SessionAlertInput): Promise<SessionAlertOutcome> {
    if (!this.sender || !this.config.sessionEmailAlertConfigured) return "disabled";

    const currentTime = this.now();
    if (currentTime < this.nextAllowedAt) return "cooldown";
    this.nextAllowedAt = currentTime + this.config.SESSION_ALERT_COOLDOWN_SECONDS * 1000;

    const detectedAt = new Date(currentTime).toISOString();
    const service = this.config.SERVICE_PUBLIC_URL.trim() || "the LinkedIn Profile API";
    await this.sender.sendMail({
      from: this.config.SESSION_ALERT_EMAIL_FROM.trim() || this.config.SMTP_USER,
      to: this.config.SESSION_ALERT_EMAIL_TO,
      subject: "[LinkedIn Profile API] Session needs attention",
      text: [
        "LinkedIn authentication is no longer available to the profile API.",
        "",
        `Reason: ${input.reason}`,
        `Detected by: ${sourceLabel(input.source)}`,
        `Detected at: ${detectedAt}`,
        `Service: ${service}`,
        "",
        "Recovery: sign in to LinkedIn normally, replace LINKEDIN_LI_AT and LINKEDIN_JSESSIONID in Render, redeploy, then verify GET /ready.",
        "",
        "No LinkedIn cookies or requested profile URLs are included in this email."
      ].join("\n")
    });
    return "sent";
  }

  private createSender(): MailSender | undefined {
    if (!this.config.sessionEmailAlertConfigured) return undefined;
    return nodemailer.createTransport({
      host: this.config.SMTP_HOST,
      port: this.config.SMTP_PORT,
      secure: this.config.SMTP_SECURE,
      auth: {
        user: this.config.SMTP_USER,
        pass: this.config.SMTP_PASS
      },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000
    });
  }
}

function sourceLabel(source: SessionAlertSource): string {
  return source === "profile_extraction" ? "a profile extraction request" : "the readiness monitor";
}
