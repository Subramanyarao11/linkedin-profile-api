import { describe, expect, it } from "vitest";
import { parseHtmlSnapshot } from "../src/extractor/html-snapshot.js";

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

const mobileProfileHtml = `<!doctype html><html><head><title>Profile | LinkedIn</title></head><body><main>
  <section>
    <img alt="Member Background Photo" data-delayed-url="https://media.example.test/profile-background.jpg">
    <img alt="Profile picture of Demo Person" data-delayed-url="https://media.example.test/profile-displayphoto.jpg">
    <div class="bg-color-background-container mx-2 mt-2 mb-1">
      <div class="flex items-center"><h1 class="text-color-text heading-large">Demo Person</h1></div>
      <div class="body-small text-color-text">Principal Engineer</div>
      <div class="body-small text-color-text-low-emphasis">Example University</div>
      <div class="body-small text-color-text-low-emphasis">Bengaluru, India 500 followers</div>
    </div>
  </section>
  <section><h2>About</h2><div>About Builds useful products.</div></section>
  <section><h2>Experience</h2><ul>
    <li class="profile-entity-lockup visible-entity"><a href="https://www.linkedin.com/company/example-labs">
      <div class="pb-1.5 flex-1 self-center">
        <div class="list-item-heading">Principal Engineer</div>
        <div class="body-small">Example Labs</div>
        <div class="body-small"><span>Feb 2022 -</span><span>Present</span><span>4 yrs</span></div>
        <div class="text-xs text-color-text-low-emphasis">Bengaluru, India</div>
        <div><div class="description">Builds reliable systems.</div></div>
      </div>
    </a></li>
  </ul></section>
  <section><h2>Accomplishments</h2>
    <div class="detail-container"><h3>Certifications</h3><ul><li class="sub-list-item">
      <div class="list-item-body"><div class="list-item-heading">Cloud Architect</div><div class="description">Example Cloud</div></div>
    </li></ul></div>
    <div class="detail-container"><h3>Languages</h3><ul><li class="sub-list-item">
      <div><div class="list-item-heading">English</div><div class="list-item-detail">Full professional proficiency</div></div>
    </li></ul></div>
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

  it("extracts LinkedIn's mobile profile fields and virtual accomplishment sections", () => {
    const snapshot = parseHtmlSnapshot(mobileProfileHtml);

    expect(snapshot.name).toBe("Demo Person");
    expect(snapshot.headline).toBe("Principal Engineer");
    expect(snapshot.location).toBe("Bengaluru, India");
    expect(snapshot.profileImage).toBe("https://media.example.test/profile-displayphoto.jpg");
    expect(snapshot.backgroundImage).toBe("https://media.example.test/profile-background.jpg");
    expect(snapshot.sections.find(({ heading }) => heading === "About")?.text)
      .toContain("Builds useful products.");
    expect(snapshot.sections.find(({ heading }) => heading === "Experience")?.links?.[0]?.text)
      .toEqual([
        "Principal Engineer",
        "Example Labs",
        "Feb 2022 - Present 4 yrs",
        "Bengaluru, India",
        "Builds reliable systems."
      ]);
    expect(snapshot.sections.map(({ heading }) => heading)).toEqual(
      expect.arrayContaining(["Certifications", "Languages"])
    );
  });
});
