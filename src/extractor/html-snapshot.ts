import { load } from "cheerio";
import type { PageSnapshot } from "../types.js";

const SECTION_HEADING = /^(about|experience|education|skills|licenses\s*&\s*certifications|certifications|languages)$/i;

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function linkedInPath(href: string | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, "https://www.linkedin.com");
    if (url.hostname !== "linkedin.com" && !url.hostname.endsWith(".linkedin.com")) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

export function parseHtmlSnapshot(html: string): PageSnapshot {
  const $ = load(html);
  const titleName = cleanText($("title").first().text()).match(/^(.+?)\s*\|\s*LinkedIn$/i)?.[1] ?? null;
  const visibleName = cleanText($("main h1, main h2").first().text()) || null;
  const name = titleName || visibleName;
  const mainSections = $("main section");
  const topSection = mainSections.first();
  const topParagraphs = unique(topSection.find("p").map((_index, element) => $(element).text()).get());
  const topValues = topParagraphs.filter((line) => isTopCardValue(line, name));
  const location = topValues.find(isLocation) ?? null;
  const headline = topValues.find((line) => line !== location) ?? null;

  const profileImage = $("main img")
    .filter((_index, element) => {
      const source = $(element).attr("src") ?? "";
      const alt = $(element).attr("alt") ?? "";
      if (/profile-background|background/i.test(`${source} ${alt}`)) return false;
      return source.includes("profile-displayphoto") || Boolean(name && alt.toLowerCase().includes(name.toLowerCase()));
    })
    .first()
    .attr("src") ?? null;
  const backgroundImage = $(
    'main img[alt*="background" i], main img[src*="profile-background"]'
  ).first().attr("src") ?? null;

  const jsonLd = $('script[type="application/ld+json"]').get().flatMap((element): unknown[] => {
    try {
      const parsed = JSON.parse($(element).text()) as unknown;
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  });

  const sections = mainSections.get().map((section) => {
    const headings = unique($(section).find("h1, h2, h3").map((_index, element) => $(element).text()).get());
    const paragraphs = unique($(section).find("p").map((_index, element) => $(element).text()).get());
    const lines = unique([...headings, ...paragraphs]);
    const heading =
      [...headings, ...paragraphs].find((line) => SECTION_HEADING.test(cleanText(line))) ??
      headings[0] ??
      paragraphs[0] ??
      "";
    const items = $(section).find("li").get().map((item) => {
      const itemParagraphs = unique($(item).find("p").map((_index, element) => $(element).text()).get());
      return itemParagraphs.length ? itemParagraphs : [cleanText($(item).text())].filter(Boolean);
    });
    const links = $(section).find("a").get().map((anchor) => {
      const anchorParagraphs = unique($(anchor).find("p").map((_index, element) => $(element).text()).get());
      return {
        text: anchorParagraphs.length ? anchorParagraphs : [cleanText($(anchor).text())].filter(Boolean),
        path: linkedInPath($(anchor).attr("href"))
      };
    });

    return {
      heading: cleanText(heading),
      text: lines.join(" "),
      items,
      lines,
      links
    };
  }).filter((section) => section.heading || section.text);

  return {
    modes: ["html"],
    name,
    headline,
    location,
    profileImage,
    backgroundImage,
    jsonLd,
    sections
  };
}

export function mergePageSnapshots(
  primary: PageSnapshot,
  details: PageSnapshot[]
): PageSnapshot {
  const snapshots = [primary, ...details];
  return {
    ...primary,
    modes: unique(snapshots.flatMap((snapshot) => snapshot.modes)) as PageSnapshot["modes"],
    jsonLd: snapshots.flatMap((snapshot) => snapshot.jsonLd),
    sections: snapshots.flatMap((snapshot) => snapshot.sections)
  };
}

export function appendRscAbout(snapshot: PageSnapshot, values: string[]): PageSnapshot {
  const text = unique(values.filter((value) => !/^about$/i.test(value)));
  if (!text.length) return snapshot;

  return {
    ...snapshot,
    modes: unique([...snapshot.modes, "rsc"]) as PageSnapshot["modes"],
    sections: [
      ...snapshot.sections,
      {
        heading: "About",
        text: `About ${text.join(" ")}`,
        items: [],
        lines: ["About", ...text],
        links: []
      }
    ]
  };
}

function isTopCardValue(line: string, name: string | null): boolean {
  if (!line || line === name) return false;
  if (/^·?\s*(1st|2nd|3rd)(\+)?$/i.test(line)) return false;
  if (/^(·|contact info|message|follow|connect|profile enhanced with premium)$/i.test(line)) return false;
  if (/followers|connections|followed by/i.test(line)) return false;
  return true;
}

function isLocation(value: string): boolean {
  return /,/.test(value) || /\b(area|region)$/i.test(value);
}
