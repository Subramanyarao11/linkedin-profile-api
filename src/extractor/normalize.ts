import type {
  Certification,
  DateRange,
  DomSnapshot,
  Education,
  Experience,
  LinkedInProfile,
  ScrapeResult,
  YearMonth
} from "../types.js";

type AnyRecord = Record<string, unknown>;
type LocatedObject = { value: AnyRecord; path: string };

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const numberValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const recordValue = (value: unknown): AnyRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as AnyRecord) : null;

function firstString(object: AnyRecord, keys: string[]): string | null {
  for (const key of keys) {
    const result = stringValue(object[key]);
    if (result) return result;
  }
  return null;
}

function collectObjects(payloads: unknown[]): LocatedObject[] {
  const objects: LocatedObject[] = [];
  const seen = new Set<object>();

  const visit = (value: unknown, path: string): void => {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }

    const object = value as AnyRecord;
    objects.push({ value: object, path });
    for (const [key, child] of Object.entries(object)) visit(child, `${path}.${key}`);
  };

  payloads.forEach((payload, index) => visit(payload, `$[${index}]`));
  return objects;
}

function objectHint(located: LocatedObject): string {
  const object = located.value;
  return [
    located.path,
    object.$type,
    object.__typename,
    object.entityUrn,
    object.trackingUrn
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function yearMonth(value: unknown): YearMonth | null {
  const object = recordValue(value);
  if (!object) return null;
  const year = numberValue(object.year);
  if (!year) return null;
  return { year, month: numberValue(object.month) };
}

function dateRange(object: AnyRecord): DateRange | null {
  const timePeriod = recordValue(object.timePeriod) ?? recordValue(object.dateRange);
  const start = yearMonth(timePeriod?.startDate ?? object.startDate);
  const end = yearMonth(timePeriod?.endDate ?? object.endDate);
  if (!start && !end) return null;
  return { start, end, isCurrent: Boolean(start && !end) };
}

function linkedInEntityUrl(object: AnyRecord): string | null {
  const direct = firstString(object, ["url", "companyUrl", "schoolUrl"]);
  if (direct?.startsWith("https://")) return direct;
  const publicIdentifier = firstString(object, ["companyPublicIdentifier", "schoolPublicIdentifier"]);
  if (!publicIdentifier) return null;
  const kind = object.schoolName ? "school" : "company";
  return `https://www.linkedin.com/${kind}/${encodeURIComponent(publicIdentifier)}/`;
}

function vectorImage(value: unknown): string | null {
  const object = recordValue(value);
  if (!object) return null;
  const rootUrl = firstString(object, ["rootUrl"]);
  const artifacts = Array.isArray(object.artifacts) ? object.artifacts : [];
  const best = artifacts
    .map(recordValue)
    .filter((artifact): artifact is AnyRecord => artifact !== null)
    .sort((a, b) => (numberValue(b.width) ?? 0) - (numberValue(a.width) ?? 0))[0];
  const segment = best ? firstString(best, ["fileIdentifyingUrlPathSegment"]) : null;
  if (rootUrl && segment) return `${rootUrl}${segment}`;
  return firstString(object, ["url"]);
}

function nestedImage(value: unknown, depth = 0): string | null {
  if (depth > 4) return null;
  const direct = vectorImage(value);
  if (direct) return direct;
  const object = recordValue(value);
  if (!object) return null;
  for (const child of Object.values(object)) {
    const image = nestedImage(child, depth + 1);
    if (image) return image;
  }
  return null;
}

function findImage(object: AnyRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = object[key];
    const direct = stringValue(value);
    if (direct?.startsWith("http")) return direct;
    const image = nestedImage(value);
    if (image) return image;
  }
  return null;
}

function dedupe<T>(values: T[], key: (value: T) => string): T[] {
  const keys = new Set<string>();
  return values.filter((value) => {
    const current = key(value).toLowerCase();
    if (!current || keys.has(current)) return false;
    keys.add(current);
    return true;
  });
}

function cleanSectionHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function domSection(snapshot: DomSnapshot | undefined, heading: string) {
  return snapshot?.sections.find((section) => cleanSectionHeading(section.heading).includes(heading));
}

function profileScore(object: AnyRecord): number {
  return ["firstName", "lastName", "headline", "summary", "publicIdentifier", "locationName"].reduce(
    (score, key) => score + (stringValue(object[key]) ? 1 : 0),
    0
  );
}

export function normalizeProfile(
  payloads: unknown[],
  snapshot: DomSnapshot | undefined,
  profileUrl: string,
  publicIdentifier: string
): ScrapeResult {
  const objects = collectObjects([...payloads, ...(snapshot?.jsonLd ?? [])]);
  const profileCandidate = objects
    .filter(({ value }) => profileScore(value) >= 2)
    .sort((a, b) => profileScore(b.value) - profileScore(a.value))[0]?.value;

  const firstName = profileCandidate ? firstString(profileCandidate, ["firstName", "givenName"]) : null;
  const lastName = profileCandidate ? firstString(profileCandidate, ["lastName", "familyName"]) : null;
  const fullName =
    snapshot?.name ??
    (profileCandidate ? firstString(profileCandidate, ["name", "formattedName"]) : null) ??
    ([firstName, lastName].filter(Boolean).join(" ") || null);

  const experiences: Experience[] = [];
  const educations: Education[] = [];
  const certifications: Certification[] = [];
  const skills: LinkedInProfile["skills"] = [];
  const languages: LinkedInProfile["languages"] = [];
  let profileImage = snapshot?.profileImage ?? null;
  let backgroundImage = snapshot?.backgroundImage ?? null;

  for (const located of objects) {
    const object = located.value;
    const hint = objectHint(located);

    if (!profileImage && (hint.includes("profile") || hint.includes("picture"))) {
      profileImage = findImage(object, ["profilePicture", "picture", "displayImage", "image"]);
    }
    if (!backgroundImage && (hint.includes("background") || hint.includes("cover"))) {
      backgroundImage = findImage(object, ["backgroundPicture", "backgroundImage", "coverImage", "image"]);
    }

    const title = firstString(object, ["title", "positionTitle"]);
    const company = firstString(object, ["companyName", "company"]);
    if ((hint.includes("position") || hint.includes("experience")) && title && (company || object.companyUrn)) {
      experiences.push({
        title,
        company,
        companyLinkedInUrl: linkedInEntityUrl(object),
        employmentType: firstString(object, ["employmentType", "employmentTypeName"]),
        location: firstString(object, ["locationName", "location"]),
        description: firstString(object, ["description", "summary"]),
        dateRange: dateRange(object)
      });
    }

    const school = firstString(object, ["schoolName", "school"]);
    if ((hint.includes("education") || object.schoolUrn) && school) {
      educations.push({
        school,
        schoolLinkedInUrl: linkedInEntityUrl(object),
        degree: firstString(object, ["degreeName", "degree"]),
        fieldOfStudy: firstString(object, ["fieldOfStudy", "fieldOfStudyName"]),
        activities: firstString(object, ["activities"]),
        description: firstString(object, ["description", "notes"]),
        dateRange: dateRange(object)
      });
    }

    const certificationName = firstString(object, ["name", "certificationName"]);
    if ((hint.includes("certification") || hint.includes("license")) && certificationName) {
      certifications.push({
        name: certificationName,
        authority: firstString(object, ["authority", "issuingOrganization", "companyName"]),
        licenseNumber: firstString(object, ["licenseNumber", "credentialId"]),
        credentialUrl: firstString(object, ["url", "credentialUrl"]),
        dateRange: dateRange(object)
      });
    }

    const skillName = firstString(object, ["name", "skillName"]);
    if (hint.includes("skill") && skillName && skillName.length <= 150) {
      skills.push({
        name: skillName,
        endorsementCount: numberValue(object.endorsementCount ?? object.numEndorsements)
      });
    }

    const languageName = firstString(object, ["name", "languageName"]);
    if (hint.includes("language") && languageName && languageName.length <= 150) {
      languages.push({
        name: languageName,
        proficiency: firstString(object, ["proficiency", "proficiencyName"])
      });
    }
  }

  const aboutSection = domSection(snapshot, "about");
  const about =
    (profileCandidate ? firstString(profileCandidate, ["summary", "about", "description"]) : null) ??
    (aboutSection?.text.replace(/^about\s*/i, "").trim() || null);

  const extractionMode: LinkedInProfile["source"]["extractionMode"] = [];
  if (payloads.length) extractionMode.push("network");
  if (snapshot?.jsonLd.length) extractionMode.push("json-ld");
  if (snapshot) extractionMode.push("dom");

  const profile: LinkedInProfile = {
    source: {
      profileUrl,
      publicIdentifier,
      fetchedAt: new Date().toISOString(),
      extractionMode,
      partial: false
    },
    name: { full: fullName, first: firstName, last: lastName },
    headline:
      (profileCandidate ? firstString(profileCandidate, ["headline", "occupation", "jobTitle"]) : null) ??
      snapshot?.headline ??
      null,
    location:
      (profileCandidate ? firstString(profileCandidate, ["locationName", "location", "addressLocality"]) : null) ??
      snapshot?.location ??
      null,
    about,
    experience: dedupe(experiences, (entry) => `${entry.title}|${entry.company ?? ""}|${entry.dateRange?.start?.year ?? ""}`),
    education: dedupe(educations, (entry) => `${entry.school}|${entry.degree ?? ""}|${entry.dateRange?.start?.year ?? ""}`),
    skills: dedupe(skills, (entry) => entry.name),
    certifications: dedupe(certifications, (entry) => `${entry.name}|${entry.authority ?? ""}`),
    languages: dedupe(languages, (entry) => entry.name),
    profileImages: { profile: profileImage, background: backgroundImage }
  };

  const warnings: string[] = [];
  if (!profile.name.full) warnings.push("Profile name could not be extracted.");
  if (!payloads.length) warnings.push("No LinkedIn JSON responses were captured; the result uses page fallbacks only.");
  if (!profile.experience.length) warnings.push("No experience entries were available or recognized.");
  if (!profile.education.length) warnings.push("No education entries were available or recognized.");
  profile.source.partial = warnings.length > 0;

  return { profile, warnings };
}
