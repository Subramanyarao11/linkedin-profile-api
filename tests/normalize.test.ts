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

  it("parses the current server-rendered top card and profile sections", () => {
    const result = normalizeProfile([], {
      name: "Demo Person",
      headline: null,
      location: null,
      profileImage: "https://media.example.test/photo.jpg",
      backgroundImage: null,
      jsonLd: [],
      sections: [
        {
          heading: "Demo Person",
          text: "Demo Person Principal Engineer Bengaluru, India",
          items: [],
          lines: ["Demo Person", "· 3rd", "Principal Engineer", "Bengaluru, India", "Contact info"],
          links: []
        },
        {
          heading: "About",
          text: "About Builds reliable systems.",
          items: [],
          lines: ["About", "Builds reliable systems."],
          links: []
        },
        {
          heading: "Experience",
          text: "Experience Principal Engineer Example Labs",
          items: [],
          lines: ["Experience", "Principal Engineer", "Example Labs", "Feb 2022 - Present · 4 yrs", "Bengaluru, India"],
          links: [{
            path: "/company/123/",
            text: ["Principal Engineer", "Example Labs", "Feb 2022 - Present · 4 yrs", "Bengaluru, India"]
          }]
        },
        {
          heading: "Education",
          text: "Education Example University",
          items: [],
          links: [{
            path: "/school/456/",
            text: ["Example University", "B.Tech, Computer Science", "2014 – 2018"]
          }]
        },
        {
          heading: "Skills",
          text: "Skills TypeScript",
          items: [["TypeScript", "42 endorsements"]]
        },
        {
          heading: "Licenses & certifications",
          text: "Cloud Architect Example Cloud",
          items: [["Cloud Architect", "Example Cloud", "Credential ID CERT-123"]]
        },
        {
          heading: "Languages",
          text: "English Full professional proficiency",
          items: [["English", "Full professional proficiency"]]
        }
      ]
    }, "https://www.linkedin.com/in/demo-person/", "demo-person");

    expect(result.profile.headline).toBe("Principal Engineer");
    expect(result.profile.location).toBe("Bengaluru, India");
    expect(result.profile.experience[0]).toEqual(expect.objectContaining({
      title: "Principal Engineer",
      company: "Example Labs",
      companyLinkedInUrl: "https://www.linkedin.com/company/123/",
      location: "Bengaluru, India",
      dateRange: { start: { year: 2022, month: 2 }, end: null, isCurrent: true }
    }));
    expect(result.profile.education[0]).toEqual(expect.objectContaining({
      school: "Example University",
      degree: "B.Tech",
      fieldOfStudy: "Computer Science"
    }));
    expect(result.profile.skills).toEqual([{ name: "TypeScript", endorsementCount: 42 }]);
    expect(result.profile.certifications[0]).toEqual(expect.objectContaining({
      name: "Cloud Architect",
      authority: "Example Cloud",
      licenseNumber: "CERT-123"
    }));
    expect(result.profile.languages).toEqual([{
      name: "English",
      proficiency: "Full professional proficiency"
    }]);
  });
});
