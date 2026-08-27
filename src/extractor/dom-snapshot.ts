import type { Page } from "playwright";
import type { DomSnapshot } from "../types.js";

// Keep this as a plain browser script. Passing a closure through the development
// transpiler can inject Node-side helper references that do not exist in the page.
const DOM_SNAPSHOT_SCRIPT = String.raw`(() => {
  const text = (element) => {
    const value = element?.textContent?.replace(/\s+/g, " ").trim();
    return value || null;
  };
  const lines = (element) =>
    ((element instanceof HTMLElement ? element.innerText : element.textContent) || "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).flatMap(
    (script) => {
      try {
        const parsed = JSON.parse(script.textContent || "null");
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    }
  );
  const h1 = document.querySelector("main h1, h1");
  const titleMatch = document.title.match(/^(.+?)\s*\|\s*LinkedIn$/i);
  const titleName = titleMatch?.[1]?.trim() || null;
  const h1Text = text(h1) || titleName;
  const profileImage = Array.from(document.querySelectorAll("main img")).find((image) => {
    const source = image.src || "";
    const alt = image.alt || "";
    if (/profile-background|background/i.test(source + " " + alt)) return false;
    return source.includes("profile-displayphoto") || Boolean(h1Text && alt.toLowerCase().includes(h1Text.toLowerCase()));
  });
  const backgroundImage = document.querySelector(
    'main img[alt*="background" i], main img[src*="profile-background"]'
  );
  const h1Parent = h1?.parentElement;
  const nearby = h1Parent ? Array.from(h1Parent.querySelectorAll(":scope > div, :scope > span")) : [];
  const nearbyText = nearby.map((element) => text(element)).filter(Boolean);
  const sections = Array.from(document.querySelectorAll("main section")).map((section) => {
    const sectionLines = lines(section);
    const firstLine = sectionLines[0] || "";
    const semanticFirstLine = /^(about|experience|education|skills|licenses\s*&\s*certifications|certifications|languages)$/i.test(firstLine);
    const heading = semanticFirstLine ? firstLine : text(section.querySelector("h2, h3")) || firstLine;
    const items = Array.from(section.querySelectorAll(":scope li")).map(lines);
    const links = Array.from(section.querySelectorAll("a")).map((anchor) => {
      let path = null;
      try {
        const url = new URL(anchor.href);
        if (url.hostname === "linkedin.com" || url.hostname.endsWith(".linkedin.com")) path = url.pathname;
      } catch {
        // Ignore malformed/non-HTTP link targets.
      }
      return { text: lines(anchor), path };
    });
    return { heading, text: text(section) || "", items, lines: sectionLines, links };
  });
  return {
    name: text(h1) || titleName,
    headline: nearbyText.find((value) => value !== text(h1) && value.length > 5) || null,
    location: nearbyText.find((value) => /,| area$| region$/i.test(value)) || null,
    profileImage: profileImage?.src || null,
    backgroundImage: backgroundImage?.src || null,
    jsonLd,
    sections
  };
})()`;

export function captureDomSnapshot(page: Page): Promise<DomSnapshot> {
  return page.evaluate<DomSnapshot>(DOM_SNAPSHOT_SCRIPT);
}

export function mergeDomSnapshots(primary: DomSnapshot, details: DomSnapshot[]): DomSnapshot {
  return {
    ...primary,
    jsonLd: [primary, ...details].flatMap((snapshot) => snapshot.jsonLd),
    sections: [primary, ...details].flatMap((snapshot) => snapshot.sections)
  };
}
