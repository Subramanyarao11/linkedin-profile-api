import { load, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { PageSnapshot } from "../types.js";

const SECTION_HEADING = /^(about|experience|education|skills|licenses\s*&\s*certifications|certifications|languages)$/i;
const GENERIC_PROFILE_HEADINGS = /^(profile|report|content credentials|highlights|featured|activity|recommendations|accomplishments|contact|install the linkedin app)$/i;

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
  const titleCandidate = cleanText($("title").first().text()).match(/^(.+?)\s*\|\s*LinkedIn$/i)?.[1] ?? null;
  const mobileName = cleanText($("main h1.heading-large").first().text()) || null;
  const headingCandidates = unique($("main h1, main h2, main h3")
    .map((_index, element) => $(element).text())
    .get())
    .filter((value) =>
      value.length <= 120 &&
      !SECTION_HEADING.test(value) &&
      !GENERIC_PROFILE_HEADINGS.test(value) &&
      !/^(add|edit|select|verify|share)\b/i.test(value)
    );
  const visibleName = mobileName ?? headingCandidates[0] ?? null;
  const name = titleCandidate && !GENERIC_PROFILE_HEADINGS.test(titleCandidate)
    ? titleCandidate
    : visibleName;
  const mainSections = $("main section");
  const mobileCard = $("main h1.heading-large").first().parent().parent();
  const topSection = mobileCard.length
    ? mobileCard.closest("section")
    : mainSections.first();
  const topParagraphs = unique(topSection.find("p").map((_index, element) => $(element).text()).get());
  const topValues = topParagraphs.filter((line) => isTopCardValue(line, name));
  const mobileHeadline = cleanText(
    mobileCard.children("div.body-small.text-color-text").not(".text-color-text-low-emphasis").first().text()
  ) || null;
  const mobileLocation = unique(
    mobileCard.children("div.body-small.text-color-text-low-emphasis")
      .map((_index, element) => $(element).text())
      .get()
      .map((value) => cleanText(value)
        .replace(/\s+\d[\d,]*\+?\s+(followers|connections).*$/i, "")
        .trim())
  ).find(isLocation) ?? null;
  const location = mobileLocation ?? topValues.find(isLocation) ?? null;
  const headline = mobileHeadline ?? topValues.find((line) => line !== location) ?? null;

  const profileImage = $("main img")
    .filter((_index, element) => {
      const source = $(element).attr("src") ?? "";
      const alt = $(element).attr("alt") ?? "";
      if (/profile-background|background/i.test(`${source} ${alt}`)) return false;
      return source.includes("profile-displayphoto") || Boolean(name && alt.toLowerCase().includes(name.toLowerCase()));
    })
    .first();
  const backgroundImage = $(
    'main img[alt*="background" i], main img[src*="profile-background"], main img[data-delayed-url*="profile-displaybackgroundimage"]'
  ).first();

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
    const heading = headings[0] ??
      paragraphs.find((line) => SECTION_HEADING.test(cleanText(line))) ??
      paragraphs[0] ??
      "";
    const items = $(section).find("li").get().map((item) => {
      const mobileLines = mobileEntityLines($, item);
      const itemParagraphs = unique($(item).find("p").map((_index, element) => $(element).text()).get());
      return mobileLines.length > 1
        ? mobileLines
        : itemParagraphs.length
          ? itemParagraphs
          : [cleanText($(item).text())].filter(Boolean);
    });
    const genericLinks = $(section).find("a").get().map((anchor) => {
      const mobileLines = mobileEntityLines($, anchor);
      const anchorParagraphs = unique($(anchor).find("p").map((_index, element) => $(element).text()).get());
      return {
        text: mobileLines.length > 1
          ? mobileLines
          : anchorParagraphs.length
            ? anchorParagraphs
            : [cleanText($(anchor).text())].filter(Boolean),
        path: linkedInPath($(anchor).attr("href"))
      };
    });
    const experienceLinks = /^experience$/i.test(cleanText(heading))
      ? mobileExperienceLinks($, section)
      : [];

    return {
      heading: cleanText(heading),
      text: cleanText($(section).text()) || lines.join(" "),
      items,
      lines,
      links: experienceLinks.length ? experienceLinks : genericLinks
    };
  }).filter((section) => section.heading || section.text);

  const detailSections = $("main .detail-container").get().flatMap((container) => {
    const heading = cleanText($(container).children("h1, h2, h3, h4").first().text());
    if (!SECTION_HEADING.test(heading)) return [];

    const items = $(container).find("li").get().map((item) => {
      const values = mobileEntityLines($, item);
      return values.length ? values : [cleanText($(item).text())].filter(Boolean);
    });
    return [{
      heading,
      text: cleanText($(container).text()),
      items,
      lines: [heading],
      links: []
    }];
  });

  return {
    modes: ["html"],
    name,
    headline,
    location,
    profileImage: imageUrl(profileImage.attr("src"), profileImage.attr("data-delayed-url")),
    backgroundImage: imageUrl(backgroundImage.attr("src"), backgroundImage.attr("data-delayed-url")),
    jsonLd,
    sections: [...sections, ...detailSections]
  };
}

function imageUrl(source: string | undefined, delayedSource: string | undefined): string | null {
  return source ?? delayedSource ?? null;
}

function mobileEntityLines($: CheerioAPI, element: AnyNode): string[] {
  const root = $(element);
  const heading = root.find(".list-item-heading").first();
  if (!heading.length) return [];

  const container = heading.parent();
  const values: string[] = [cleanText(heading.text())];
  container.children("div").each((_index, child) => {
    if ($(child).find(".list-item-heading").length || $(child).hasClass("list-item-heading")) return;
    const description = cleanText($(child).find(".description").first().text());
    const spanValues = unique($(child).find("span").map((_spanIndex, span) => $(span).text()).get());
    const clone = $(child).clone();
    clone.find("button, svg, li-icon").remove();
    const value = description || (spanValues.length ? spanValues.join(" ") : cleanText(clone.text()));
    if (value) values.push(value);
  });
  return unique(values);
}

function mobileExperienceLinks(
  $: CheerioAPI,
  section: AnyNode
): Array<{ text: string[]; path: string | null }> {
  const values: Array<{ text: string[]; path: string | null }> = [];
  const outerItems = $(section).find("li.profile-entity-lockup").filter((_index, item) =>
    $(item).parents("li.profile-entity-lockup").length === 0
  );

  outerItems.each((_index, item) => {
    const root = $(item);
    const roles = root.find("li.role-container");
    if (roles.length) {
      const companyAnchor = root.find("a").filter((_anchorIndex, anchor) =>
        $(anchor).parents("li.role-container").length === 0
      ).first();
      const company = cleanText(companyAnchor.find(".list-item-heading").first().text()) ||
        cleanText(companyAnchor.text());
      const path = linkedInPath(companyAnchor.attr("href"));

      roles.each((_roleIndex, role) => {
        const roleRoot = $(role);
        const title = cleanText(roleRoot.find(".body-small-bold").first().text());
        const dates = cleanText(roleRoot.find("div.body-small.text-color-text").first().text());
        const location = cleanText(roleRoot.find(".text-xs.text-color-text-low-emphasis").first().text());
        const description = cleanText(roleRoot.find(".description").first().text());
        const text = unique([title, company, dates, location, description]);
        if (text.length >= 3) values.push({ text, path });
      });
      return;
    }

    const anchor = root.find("a").filter((_anchorIndex, candidate) =>
      $(candidate).find(".list-item-heading").length > 0
    ).first();
    const text = mobileEntityLines($, anchor.get(0) ?? item);
    if (text.length >= 3) values.push({ text, path: linkedInPath(anchor.attr("href")) });
  });

  return values;
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
