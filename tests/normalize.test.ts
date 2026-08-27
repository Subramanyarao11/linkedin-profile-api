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
    expect(result.profile.name.first).toBe("Visible");
    expect(result.profile.name.last).toBe("Person");
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

  it("prefers a fuller detail section over the main-page preview", () => {
    const result = normalizeProfile([], {
      name: "Demo Person",
      headline: "Engineer",
      location: null,
      profileImage: null,
      backgroundImage: null,
      jsonLd: [],
      sections: [
        { heading: "Skills", text: "Skills TypeScript", items: [["TypeScript"]] },
        {
          heading: "Skills",
          text: "Skills TypeScript API Design Distributed Systems",
          items: [["TypeScript"], ["API Design"], ["Distributed Systems"]]
        }
      ]
    }, "https://www.linkedin.com/in/demo-person/", "demo-person");

    expect(result.profile.skills.map(({ name }) => name)).toEqual([
      "TypeScript",
      "API Design",
      "Distributed Systems"
    ]);
  });

  it("does not confuse the signed-in viewer with the requested profile", () => {
    const result = normalizeProfile([{
      included: [
        {
          $type: "com.linkedin.voyager.identity.shared.MiniProfile",
          firstName: "Viewer",
          lastName: "Account",
          publicIdentifier: "viewer-account",
          headline: "Viewer headline",
          locationName: "Viewer location",
          summary: "Viewer summary"
        },
        {
          $type: "com.linkedin.voyager.identity.shared.MiniProfile",
          firstName: "Target",
          lastName: "Person",
          publicIdentifier: "target-person",
          headline: "Target headline"
        }
      ]
    }], {
      name: "Target Person",
      headline: "Visible target headline",
      location: "Target location",
      profileImage: null,
      backgroundImage: null,
      jsonLd: [],
      sections: []
    }, "https://www.linkedin.com/in/target-person/", "target-person");

    expect(result.profile.name.full).toBe("Target Person");
    expect(result.profile.headline).toBe("Target headline");
    expect(result.profile.location).toBe("Target location");
    expect(result.profile.about).toBeNull();
  });

  it("parses education anchors from the current detail-page layout", () => {
    const result = normalizeProfile([], {
      name: "Demo Person",
      headline: "Engineer",
      location: null,
      profileImage: null,
      backgroundImage: null,
      jsonLd: [],
      sections: [{
        heading: "Education",
        text: "Education Example Business School Example Institute",
        items: [],
        links: [
          { path: "/school/1/", text: [] },
          { path: "/school/1/", text: ["Example Business School", "1994 – 1996"] },
          { path: "/school/2/", text: ["Example Institute", "Bachelor’s Degree, Engineering"] }
        ]
      }]
    }, "https://www.linkedin.com/in/demo-person/", "demo-person");

    expect(result.profile.education).toEqual([
      expect.objectContaining({
        school: "Example Business School",
        degree: null,
        dateRange: { start: { year: 1994, month: null }, end: { year: 1996, month: null }, isCurrent: false }
      }),
      expect.objectContaining({
        school: "Example Institute",
        degree: "Bachelor’s Degree",
        fieldOfStudy: "Engineering"
      })
    ]);
  });
});
