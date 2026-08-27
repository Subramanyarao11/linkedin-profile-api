import { describe, expect, it } from "vitest";
import { mergeDomSnapshots } from "../src/extractor/browser.js";
import type { DomSnapshot } from "../src/types.js";

const primary: DomSnapshot = {
  name: "Demo Person",
  headline: "Engineer",
  location: "Bengaluru, India",
  profileImage: "https://media.example.test/profile.jpg",
  backgroundImage: null,
  jsonLd: [{ "@type": "Person" }],
  sections: [{ heading: "Experience", text: "Experience", items: [] }]
};

describe("mergeDomSnapshots", () => {
  it("keeps the main top card and appends detail data", () => {
    const detail: DomSnapshot = {
      name: "Experience",
      headline: null,
      location: null,
      profileImage: null,
      backgroundImage: null,
      jsonLd: [{ "@type": "ItemList" }],
      sections: [{ heading: "Skills", text: "Skills TypeScript", items: [["TypeScript"]] }]
    };

    const merged = mergeDomSnapshots(primary, [detail]);

    expect(merged.name).toBe("Demo Person");
    expect(merged.profileImage).toBe("https://media.example.test/profile.jpg");
    expect(merged.jsonLd).toHaveLength(2);
    expect(merged.sections.map(({ heading }) => heading)).toEqual(["Experience", "Skills"]);
  });
});
