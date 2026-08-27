import { describe, expect, it } from "vitest";
import {
  appendRscAbout,
  mergePageSnapshots,
  parseHtmlSnapshot
} from "../src/extractor/html-snapshot.js";

const profileHtml = `<!doctype html>
<html>
  <head><title>Demo Person | LinkedIn</title></head>
  <body><main>
    <section>
      <h2>Demo Person</h2>
      <img src="https://media.example.test/profile-displayphoto.jpg" alt="Demo Person">
      <p>· 3rd</p><p>Principal Engineer</p><p>Example Labs</p><p>Bengaluru, India</p>
      <p>Contact info</p><p>500+ connections</p>
    </section>
  </main></body>
</html>`;

const experienceHtml = `<!doctype html>
<html><head><title>Demo Person | LinkedIn</title></head><body><main>
  <section>
    <p>Experience</p>
    <a href="https://www.linkedin.com/company/example-labs/">
      <p>Principal Engineer</p><p>Example Labs</p><p>Feb 2022 - Present · 4 yrs</p>
      <p>Bengaluru, India</p><p>Builds reliable systems.</p>
    </a>
  </section>
</main></body></html>`;

describe("HTML snapshots", () => {
  it("extracts the current server-rendered top card without a browser", () => {
    const snapshot = parseHtmlSnapshot(profileHtml);

    expect(snapshot.name).toBe("Demo Person");
    expect(snapshot.headline).toBe("Principal Engineer");
    expect(snapshot.location).toBe("Bengaluru, India");
    expect(snapshot.profileImage).toBe("https://media.example.test/profile-displayphoto.jpg");
    expect(snapshot.modes).toEqual(["html"]);
  });

  it("keeps the main top card and appends detail and RSC card data", () => {
    const primary = appendRscAbout(parseHtmlSnapshot(profileHtml), [
      "About",
      "I build useful products."
    ]);
    const merged = mergePageSnapshots(primary, [parseHtmlSnapshot(experienceHtml)]);

    expect(merged.name).toBe("Demo Person");
    expect(merged.modes).toEqual(["html", "rsc"]);
    expect(merged.sections.map(({ heading }) => heading)).toContain("Experience");
    expect(merged.sections.map(({ heading }) => heading)).toContain("About");
  });
});
