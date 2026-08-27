import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeProfile } from "../src/extractor/normalize.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/profile-payload.json", import.meta.url), "utf8")
) as unknown;

describe("normalizeProfile", () => {
  it("maps captured LinkedIn entities to the public response schema", () => {
    const result = normalizeProfile(
      [fixture],
      undefined,
      "https://www.linkedin.com/in/demo-person/",
      "demo-person"
    );

    expect(result.profile.name).toEqual({ full: "Demo Person", first: "Demo", last: "Person" });
    expect(result.profile.headline).toBe("Principal Engineer at Example Labs");
    expect(result.profile.about).toBe("I build reliable distributed systems.");
    expect(result.profile.experience).toEqual([
      expect.objectContaining({
        title: "Principal Engineer",
        company: "Example Labs",
        companyLinkedInUrl: "https://www.linkedin.com/company/example-labs/",
        dateRange: {
          start: { year: 2022, month: 6 },
          end: null,
          isCurrent: true
        }
      })
    ]);
    expect(result.profile.education[0]).toEqual(
      expect.objectContaining({
        school: "Example Institute of Technology",
        degree: "Bachelor of Technology",
        fieldOfStudy: "Computer Science"
      })
    );
    expect(result.profile.skills).toEqual([{ name: "TypeScript", endorsementCount: 42 }]);
    expect(result.profile.certifications[0]).toEqual(
      expect.objectContaining({ name: "Cloud Architect", authority: "Example Cloud" })
    );
    expect(result.profile.languages).toEqual([{ name: "English", proficiency: "FULL_PROFESSIONAL" }]);
    expect(result.profile.profileImages.profile).toBe("https://media.example.test/profile/large.jpg");
    expect(result.profile.source.partial).toBe(false);
  });

  it("uses DOM fallback data and marks sparse results partial", () => {
    const result = normalizeProfile([], {
      name: "Visible Person",
      headline: "Designer",
      location: "Mumbai, India",
      profileImage: "https://media.example.test/photo.jpg",
      backgroundImage: null,
      jsonLd: [],
      sections: [{ heading: "About", text: "About Builds useful products.", items: [] }]
    }, "https://www.linkedin.com/in/visible-person/", "visible-person");

    expect(result.profile.name.full).toBe("Visible Person");
    expect(result.profile.about).toBe("Builds useful products.");
    expect(result.profile.source.extractionMode).toEqual(["dom"]);
    expect(result.profile.source.partial).toBe(true);
  });
});
