import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { ScrapeError } from "../src/errors.js";
import { LinkedInHttpExtractor } from "../src/extractor/linkedin-http.js";

const aboutComponent = "com.linkedin.sdui.generated.profile.dsl.impl.profileCardsAboveActivity";
const hydration = `0:{"newComponentId":"${aboutComponent}","requestedArguments":{"payload":{"profileId":"demo"},"requestMetadata":{"$type":"metadata"}}}\n`;

const mainHtml = `<!doctype html><html><head><title>Demo Person | LinkedIn</title></head><body>
<main><section><h2>Demo Person</h2><img src="https://media.example.test/profile-displayphoto.jpg">
<p>Principal Engineer</p><p>Bengaluru, India</p></section></main>
<script id="rehydrate-data">window.__como_rehydration__ = ${JSON.stringify([hydration])};</script>
</body></html>`;

const aboutStream = [
  '0:["$","div",null,{"componentkey":"profile.About","children":"$1"}]\n',
  '1:["$","p",null,{"children":["About","$2"]}]\n',
  '2:"I build reliable systems."\n'
].join("");

const details: Record<string, string> = {
  experience: `<main><section><p>Experience</p><a href="/company/example-labs/"><p>Principal Engineer</p><p>Example Labs</p><p>Feb 2022 - Present · 4 yrs</p><p>Bengaluru, India</p></a></section></main>`,
  education: `<main><section><p>Education</p><a href="/school/example-university/"><p>Example University</p><p>B.Tech, Computer Science</p><p>2014 - 2018</p></a></section></main>`,
  skills: `<main><section><p>Skills</p><ul><li><p>TypeScript</p><p>42 endorsements</p></li></ul></section></main>`,
  certifications: `<main><section><p>Licenses &amp; certifications</p><ul><li><p>Cloud Architect</p><p>Example Cloud</p><p>Credential ID CERT-123</p></li></ul></section></main>`,
  languages: `<main><section><p>Languages</p><ul><li><p>English</p><p>Full professional proficiency</p></li></ul></section></main>`
};

function testConfig() {
  return loadConfig({
    NODE_ENV: "test",
    LINKEDIN_LI_AT: "synthetic-li-at",
    LINKEDIN_JSESSIONID: '"ajax:synthetic"'
  });
}

describe("LinkedInHttpExtractor", () => {
  it("uses only direct LinkedIn HTTP endpoints and normalizes the responses", async () => {
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("rsc-action/actions/component")) {
        expect(init?.method).toBe("POST");
        expect((init?.headers as Record<string, string>)["x-li-rsc-stream"]).toBe("true");
        return new Response(aboutStream, { status: 200 });
      }
      for (const [section, html] of Object.entries(details)) {
        if (url.includes(`/details/${section}/`)) return new Response(html, { status: 200 });
      }
      return new Response(mainHtml, { status: 200 });
    });
    const extractor = new LinkedInHttpExtractor(testConfig(), request as typeof fetch);

    const result = await extractor.scrape(
      "https://www.linkedin.com/in/demo-person/",
      "demo-person"
    );

    expect(request).toHaveBeenCalledTimes(7);
    expect(request.mock.calls.map(([input]) => String(input))).toEqual(expect.arrayContaining([
      "https://www.linkedin.com/in/demo-person/",
      expect.stringContaining("/flagship-web/rsc-action/actions/component?componentId="),
      "https://www.linkedin.com/in/demo-person/details/experience/"
    ]));
    expect(result.profile.source.extractionMode).toEqual(["html", "rsc"]);
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
