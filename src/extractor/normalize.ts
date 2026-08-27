import type {
  Certification,
  DomSnapshot,
  Education,
  Experience,
  LinkedInProfile,
  ScrapeResult
} from "../types.js";
import {
  domDateRange,
  domEducations,
  domExperiences,
  domItems,
  domSection,
  profileTopCard
} from "./normalization/dom.js";
import {
  type AnyRecord,
  type LocatedObject,
  collectObjects,
  dateRange,
  dedupe,
  findImage,
  firstString,
  linkedInEntityUrl,
  numberValue,
  objectHint,
  stringValue
} from "./normalization/value.js";

type ExtractedEntities = {
  experiences: Experience[];
  educations: Education[];
  certifications: Certification[];
  skills: LinkedInProfile["skills"];
  languages: LinkedInProfile["languages"];
};

function profileScore(object: AnyRecord): number {
  return ["firstName", "lastName", "headline", "summary", "publicIdentifier", "locationName"]
    .reduce((score, key) => score + (stringValue(object[key]) ? 1 : 0), 0);
}

function normalizedIdentity(value: string | null): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function candidateName(object: AnyRecord): string | null {
  const direct = firstString(object, ["name", "formattedName"]);
  if (direct) return direct;

  const first = firstString(object, ["firstName", "givenName"]);
  const last = firstString(object, ["lastName", "familyName"]);
  return [first, last].filter(Boolean).join(" ") || null;
}

function selectProfileCandidate(
  objects: LocatedObject[],
  snapshot: DomSnapshot | undefined,
  publicIdentifier: string
): AnyRecord | undefined {
  const candidates = objects
    .filter(({ value }) => profileScore(value) >= 2)
    .sort((left, right) => profileScore(right.value) - profileScore(left.value));
  const targetIdentifier = normalizedIdentity(publicIdentifier);
  const targetName = normalizedIdentity(snapshot?.name ?? null);

  return (
    candidates.find(
      ({ value }) =>
        targetIdentifier ===
        normalizedIdentity(
          firstString(value, ["publicIdentifier", "vanityName", "profilePublicIdentifier"])
        )
    )?.value ??
    candidates.find(
      ({ value }) =>
        Boolean(targetName) && targetName === normalizedIdentity(candidateName(value))
    )?.value ??
    (snapshot?.name ? undefined : candidates[0]?.value)
  );
}

function resolveName(profileCandidate: AnyRecord | undefined, visibleName: string | null | undefined) {
  const first = profileCandidate
    ? firstString(profileCandidate, ["firstName", "givenName"])
    : null;
  const last = profileCandidate
    ? firstString(profileCandidate, ["lastName", "familyName"])
    : null;
  const full =
    visibleName ??
    (profileCandidate ? firstString(profileCandidate, ["name", "formattedName"]) : null) ??
    ([first, last].filter(Boolean).join(" ") || null);
  const visibleParts = full?.split(/\s+/).filter(Boolean) ?? [];

  return {
    full,
    first: first ?? visibleParts[0] ?? null,
    last: last ?? (visibleParts.length > 1 ? visibleParts.at(-1) ?? null : null)
  };
}

function extractEntities(objects: LocatedObject[]): ExtractedEntities {
  const entities: ExtractedEntities = {
    experiences: [],
    educations: [],
    certifications: [],
    skills: [],
    languages: []
  };

  for (const located of objects) {
    const object = located.value;
    const hint = objectHint(located);

    appendExperience(entities.experiences, object, hint);
    appendEducation(entities.educations, object, hint);
    appendCertification(entities.certifications, object, hint);
    appendSkill(entities.skills, object, hint);
    appendLanguage(entities.languages, object, hint);
  }

  return entities;
}

function appendExperience(values: Experience[], object: AnyRecord, hint: string): void {
  const title = firstString(object, ["title", "positionTitle"]);
  const company = firstString(object, ["companyName", "company"]);
  if (!(hint.includes("position") || hint.includes("experience"))) return;
  if (!title || (!company && !object.companyUrn)) return;

  values.push({
    title,
    company,
    companyLinkedInUrl: linkedInEntityUrl(object),
    employmentType: firstString(object, ["employmentType", "employmentTypeName"]),
    location: firstString(object, ["locationName", "location"]),
    description: firstString(object, ["description", "summary"]),
    dateRange: dateRange(object)
  });
}

function appendEducation(values: Education[], object: AnyRecord, hint: string): void {
  const school = firstString(object, ["schoolName", "school"]);
  if (!(hint.includes("education") || object.schoolUrn) || !school) return;

  values.push({
    school,
    schoolLinkedInUrl: linkedInEntityUrl(object),
    degree: firstString(object, ["degreeName", "degree"]),
    fieldOfStudy: firstString(object, ["fieldOfStudy", "fieldOfStudyName"]),
    activities: firstString(object, ["activities"]),
    description: firstString(object, ["description", "notes"]),
    dateRange: dateRange(object)
  });
}

function appendCertification(values: Certification[], object: AnyRecord, hint: string): void {
  const name = firstString(object, ["name", "certificationName"]);
  if (!(hint.includes("certification") || hint.includes("license")) || !name) return;

  values.push({
    name,
    authority: firstString(object, ["authority", "issuingOrganization", "companyName"]),
    licenseNumber: firstString(object, ["licenseNumber", "credentialId"]),
    credentialUrl: firstString(object, ["url", "credentialUrl"]),
    dateRange: dateRange(object)
  });
}

function appendSkill(
  values: LinkedInProfile["skills"],
  object: AnyRecord,
  hint: string
): void {
  const name = firstString(object, ["name", "skillName"]);
  if (!hint.includes("skill") || !name || name.length > 150) return;

  values.push({
    name,
    endorsementCount: numberValue(object.endorsementCount ?? object.numEndorsements)
  });
}

function appendLanguage(
  values: LinkedInProfile["languages"],
  object: AnyRecord,
  hint: string
): void {
  const name = firstString(object, ["name", "languageName"]);
  if (!hint.includes("language") || !name || name.length > 150) return;

  values.push({
    name,
    proficiency: firstString(object, ["proficiency", "proficiencyName"])
  });
}

function extractionModes(
  payloads: unknown[],
  snapshot: DomSnapshot | undefined
): LinkedInProfile["source"]["extractionMode"] {
  const modes: LinkedInProfile["source"]["extractionMode"] = [];
  if (payloads.length) modes.push("network");
  if (snapshot?.jsonLd.length) modes.push("json-ld");
  if (snapshot) modes.push("dom");
  return modes;
}

function profileWarnings(profile: LinkedInProfile, hasNetworkPayloads: boolean): string[] {
  const warnings: string[] = [];
  if (!profile.name.full) warnings.push("Profile name could not be extracted.");
  if (!hasNetworkPayloads) {
    warnings.push("No LinkedIn JSON responses were captured; the result uses page fallbacks only.");
  }
  if (!profile.experience.length) warnings.push("No experience entries were available or recognized.");
  if (!profile.education.length) warnings.push("No education entries were available or recognized.");
  if (!profile.skills.length) warnings.push("No skills were available or recognized.");
  if (!profile.certifications.length) {
    warnings.push("No certifications were available or recognized.");
  }
  if (!profile.languages.length) warnings.push("No languages were available or recognized.");
  return warnings;
}

export function normalizeProfile(
  payloads: unknown[],
  snapshot: DomSnapshot | undefined,
  profileUrl: string,
  publicIdentifier: string
): ScrapeResult {
  const objects = collectObjects([...payloads, ...(snapshot?.jsonLd ?? [])]);
  const profileCandidate = selectProfileCandidate(objects, snapshot, publicIdentifier);
  const entities = extractEntities(objects);
  const name = resolveName(profileCandidate, snapshot?.name);
  const topCard = profileTopCard(snapshot);

  const aboutSection = domSection(snapshot, "about");
  const about =
    (profileCandidate ? firstString(profileCandidate, ["summary", "about", "description"]) : null) ??
    (aboutSection?.text.replace(/^about\s*/i, "").trim() || null);

  const domSkills = domItems(snapshot, "skill").map((item) => ({
    name: item[0] ?? "",
    endorsementCount: numberValue(
      Number(item.find((line) => /endorsement/i.test(line))?.match(/\d+/)?.[0])
    )
  }));
  const domCertifications = domItems(snapshot, "certification").map(
    (item): Certification => ({
      name: item[0] ?? "",
      authority: item[1] ?? null,
      licenseNumber:
        item.find((line) => /credential id/i.test(line))?.replace(/^.*credential id\s*/i, "") ||
        null,
      credentialUrl: null,
      dateRange: domDateRange(
        item.find((line) => /issued|expires/i.test(line))?.replace(/^issued\s*/i, "")
      )
    })
  );
  const domLanguages = domItems(snapshot, "language").map((item) => ({
    name: item[0] ?? "",
    proficiency: item[1] ?? null
  }));

  const profile: LinkedInProfile = {
    source: {
      profileUrl,
      publicIdentifier,
      fetchedAt: new Date().toISOString(),
      extractionMode: extractionModes(payloads, snapshot),
      partial: false
    },
    name,
    headline:
      (profileCandidate
        ? firstString(profileCandidate, ["headline", "occupation", "jobTitle"])
        : null) ??
      snapshot?.headline ??
      topCard.headline ??
      null,
    location:
      (profileCandidate
        ? firstString(profileCandidate, ["locationName", "location", "addressLocality"])
        : null) ??
      snapshot?.location ??
      topCard.location ??
      null,
    about,
    experience: dedupe(
      [...entities.experiences, ...domExperiences(snapshot)],
      (entry) => `${entry.title}|${entry.company ?? ""}|${entry.dateRange?.start?.year ?? ""}`
    ),
    education: dedupe(
      [...entities.educations, ...domEducations(snapshot)],
      (entry) => `${entry.school}|${entry.degree ?? ""}|${entry.dateRange?.start?.year ?? ""}`
    ),
    skills: dedupe([...entities.skills, ...domSkills], (entry) => entry.name),
    certifications: dedupe(
      [...entities.certifications, ...domCertifications],
      (entry) => `${entry.name}|${entry.authority ?? ""}`
    ),
    languages: dedupe([...entities.languages, ...domLanguages], (entry) => entry.name),
    profileImages: {
      profile:
        snapshot?.profileImage ??
        (profileCandidate
          ? findImage(profileCandidate, ["profilePicture", "picture", "displayImage", "image"])
          : null),
      background:
        snapshot?.backgroundImage ??
        (profileCandidate
          ? findImage(profileCandidate, ["backgroundPicture", "backgroundImage", "coverImage"])
          : null)
    }
  };

  const warnings = profileWarnings(profile, payloads.length > 0);
  profile.source.partial = warnings.length > 0;
  return { profile, warnings };
}
