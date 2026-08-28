import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { ScrapeError } from "../src/errors.js";
import { LinkedInHttpExtractor } from "../src/extractor/linkedin-http.js";

const mainHtml = `<!doctype html><html><head><title>Demo Person | LinkedIn</title></head><body>
<main><section><h2>Demo Person</h2><img src="https://media.example.test/profile-displayphoto.jpg">
<p>Principal Engineer</p><p>Bengaluru, India</p></section>
<section><h2>About</h2><p>I build reliable systems.</p></section>
<section><p>Experience</p><a href="/company/example-labs/"><p>Principal Engineer</p><p>Example Labs</p><p>Feb 2022 - Present · 4 yrs</p><p>Bengaluru, India</p></a></section>
<section><p>Education</p><a href="/school/example-university/"><p>Example University</p><p>B.Tech, Computer Science</p><p>2014 - 2018</p></a></section>
<section><p>Skills</p><ul><li><p>TypeScript</p><p>42 endorsements</p></li></ul></section>
<section><p>Licenses &amp; certifications</p><ul><li><p>Cloud Architect</p><p>Example Cloud</p><p>Credential ID CERT-123</p></li></ul></section>
<section><p>Languages</p><ul><li><p>English</p><p>Full professional proficiency</p></li></ul></section>
</main></body></html>`;

function testConfig() {
  return loadConfig({
    NODE_ENV: "test",
    LINKEDIN_LI_AT: "synthetic-li-at",
    LINKEDIN_JSESSIONID: '"ajax:synthetic"'
  });
}

describe("LinkedInHttpExtractor", () => {
  it("uses only direct LinkedIn HTTP endpoints and normalizes the responses", async () => {
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["sec-ch-ua-mobile"]).toBe("?1");
      return new Response(mainHtml, { status: 200 });
    });
    const extractor = new LinkedInHttpExtractor(testConfig(), request as typeof fetch);

    const result = await extractor.scrape(
      "https://www.linkedin.com/in/demo-person/",
      "demo-person"
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://www.linkedin.com/mwlite/profile/in/demo-person"
    );
    expect(result.profile.source.extractionMode).toEqual(["html"]);
    expect(result.profile.name.full).toBe("Demo Person");
    expect(result.profile.about).toBe("I build reliable systems.");
    expect(result.profile.experience[0]).toEqual(expect.objectContaining({
      title: "Principal Engineer",
      company: "Example Labs"
    }));
    expect(result.profile.education[0]).toEqual(expect.objectContaining({
      school: "Example University",
      degree: "B.Tech"
    }));
    expect(result.profile.skills).toEqual([{ name: "TypeScript", endorsementCount: 42 }]);
    expect(result.profile.certifications[0]).toEqual(expect.objectContaining({
      name: "Cloud Architect",
      licenseNumber: "CERT-123"
    }));
    expect(result.profile.languages).toEqual([{
      name: "English",
      proficiency: "Full professional proficiency"
    }]);
    expect(result.warnings).toEqual([]);
  });

  it("requires both session cookies before making a request", async () => {
    const request = vi.fn();
    const extractor = new LinkedInHttpExtractor(
      loadConfig({ NODE_ENV: "test", LINKEDIN_LI_AT: "only-one-cookie" }),
      request as typeof fetch
    );

    await expect(extractor.scrape("https://www.linkedin.com/in/demo/", "demo"))
      .rejects.toMatchObject({ code: "authentication_required", statusCode: 503 });
    expect(request).not.toHaveBeenCalled();
  });

  it("does not follow login redirects", async () => {
    const request = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: "https://www.linkedin.com/login" }
    }));
    const extractor = new LinkedInHttpExtractor(testConfig(), request as typeof fetch);

    await expect(extractor.scrape("https://www.linkedin.com/in/demo/", "demo"))
      .rejects.toEqual(expect.objectContaining<Partial<ScrapeError>>({
        code: "authentication_required",
        statusCode: 503
      }));
  });
});
