import type { DateRange, Education, Experience, PageSnapshot, YearMonth } from "../../types.js";
import { dedupe } from "./value.js";

const monthNumbers: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
};

function cleanSectionHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

export function domSection(snapshot: PageSnapshot | undefined, heading: string) {
  return snapshot?.sections
    .filter((section) => cleanSectionHeading(section.heading).includes(heading))
    .sort((left, right) => sectionScore(right) - sectionScore(left))[0];
}

function sectionScore(section: PageSnapshot["sections"][number]): number {
  return (section.links?.length ?? 0) * 4 + section.items.length * 3 + section.text.length / 100;
}

function domYearMonth(value: string): YearMonth | null {
  const match = value.trim().match(/^(?:([A-Za-z]{3,9})\s+)?(\d{4})$/);
  if (!match?.[2]) return null;

  const monthName = match[1]?.slice(0, 3).toLowerCase();
  return {
    year: Number(match[2]),
    month: monthName ? monthNumbers[monthName] ?? null : null
  };
}

export function domDateRange(value: string | undefined): DateRange | null {
  if (!value) return null;

  const dates = value.split("·")[0]?.trim().split(/\s+[-–—]\s+/);
  if (!dates?.length || dates.length > 2) return null;

  const start = domYearMonth(dates[0] ?? "");
  const endText = dates[1]?.trim() ?? "";
  const isCurrent = /^(present|current)$/i.test(endText);
  const end = isCurrent ? null : domYearMonth(endText);
  if (!start && !end) return null;
  return { start, end, isCurrent };
}

export function profileTopCard(
  snapshot: PageSnapshot | undefined
): { headline: string | null; location: string | null } {
  if (!snapshot?.name) return { headline: null, location: null };

  const candidates = snapshot.sections
    .filter((section) => section.heading.trim() === snapshot.name && section.lines?.length)
    .sort((left, right) => (left.lines?.length ?? 0) - (right.lines?.length ?? 0));
  const lines = [...(candidates[0]?.lines ?? snapshot.sections[0]?.lines ?? [])];
  const nameIndex = lines.indexOf(snapshot.name);
  const values = lines.slice(nameIndex >= 0 ? nameIndex + 1 : 0).filter(isTopCardValue);

  return { headline: values[0] ?? null, location: values[1] ?? null };
}

function isTopCardValue(line: string): boolean {
  if (/^·?\s*(1st|2nd|3rd)(\+)?$/i.test(line)) return false;
  if (/^(·|contact info|message|profile enhanced with premium)$/i.test(line)) return false;
  return !/followers|followed by/i.test(line);
}

export function domExperiences(snapshot: PageSnapshot | undefined): Experience[] {
  const section = domSection(snapshot, "experience");
  if (!section?.links) return [];

  return section.links.flatMap((link): Experience[] => {
    if (!link.path || !/^\/(company|school)\//.test(link.path) || link.text.length < 3) {
      return [];
    }

    const [title, company, dates, ...remaining] = link.text;
    if (!title || !company || !dates) return [];

    const location =
      remaining[0] &&
      (/,/.test(remaining[0]) || /\b(area|remote|hybrid|on-site|onsite)$/i.test(remaining[0]))
        ? remaining.shift() ?? null
        : null;

    return [
      {
        title,
        company,
        companyLinkedInUrl: `https://www.linkedin.com${link.path}`,
        employmentType: null,
        location,
        description: remaining.length ? remaining.join("\n") : null,
        dateRange: domDateRange(dates)
      }
    ];
  });
}

export function domEducations(snapshot: PageSnapshot | undefined): Education[] {
  const section = domSection(snapshot, "education");
  if (!section?.links) return [];

  return section.links.flatMap((link): Education[] => {
    if (!link.path?.startsWith("/school/") || !link.text[0]) return [];

    const [school, ...details] = link.text;
    const dateIndex = details.findIndex((line) => domDateRange(line) !== null);
    const dates = dateIndex >= 0 ? details[dateIndex] : undefined;
    const degreeLine = details.find((_line, index) => index !== dateIndex);
    const remaining = details.filter((line, index) => index !== dateIndex && line !== degreeLine);
    const degreeParts = degreeLine?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];

    return [
      {
        school,
        schoolLinkedInUrl: `https://www.linkedin.com${link.path}`,
        degree: degreeParts[0] ?? null,
        fieldOfStudy: degreeParts.slice(1).join(", ") || null,
        activities: null,
        description: remaining.length ? remaining.join("\n") : null,
        dateRange: domDateRange(dates)
      }
    ];
  });
}

export function domItems(snapshot: PageSnapshot | undefined, heading: string): string[][] {
  const section = domSection(snapshot, heading);
  if (!section) return [];

  return dedupe(
    [...section.items, ...(section.links ?? []).map((link) => link.text)].filter(
      (item) =>
        item.length &&
        cleanSectionHeading(item[0] ?? "") !== cleanSectionHeading(section.heading)
    ),
    (item) => item.join("|")
  );
}
