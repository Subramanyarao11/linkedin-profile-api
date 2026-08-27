import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { LinkedInSession } from "../src/linkedin-session.js";

describe("LinkedInSession", () => {
  it("uses configured cookies and honors server-issued auth-cookie rotations", () => {
    const session = new LinkedInSession(loadConfig({
      LINKEDIN_LI_AT: "initial-li-at",
      LINKEDIN_JSESSIONID: '"ajax:initial"'
    }));
    const headers = new Headers();
    headers.append("set-cookie", "li_at=rotated-li-at; Path=/; Secure; HttpOnly");
    headers.append("set-cookie", 'JSESSIONID="ajax:rotated"; Path=/; Secure');

    session.captureRotations(headers);

    expect(session.authHeaders()).toEqual(expect.objectContaining({
      cookie: 'li_at=rotated-li-at; JSESSIONID="ajax:rotated"',
      "csrf-token": "ajax:rotated"
    }));
  });

  it("ignores unrelated cookie rotations", () => {
    const session = new LinkedInSession(loadConfig({
      LINKEDIN_LI_AT: "initial-li-at",
      LINKEDIN_JSESSIONID: '"ajax:initial"'
    }));
    session.captureRotations(new Headers({
      "set-cookie": "lidc=ancillary-value; Path=/; Secure"
    }));

    expect(session.authHeaders().cookie).toBe(
      'li_at=initial-li-at; JSESSIONID="ajax:initial"'
    );
  });

  it("clears an authentication cookie when LinkedIn expires it", () => {
    const session = new LinkedInSession(loadConfig({
      LINKEDIN_LI_AT: "initial-li-at",
      LINKEDIN_JSESSIONID: '"ajax:initial"'
    }));
    session.captureRotations(new Headers({
      "set-cookie": "li_at=obsolete-value; Max-Age=0; Expires=Thu, 01-Jan-1970 00:00:00 GMT"
    }));

    expect(session.configured).toBe(false);
  });
});
