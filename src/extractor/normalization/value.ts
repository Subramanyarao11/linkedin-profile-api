import type { DateRange, YearMonth } from "../../types.js";

export type AnyRecord = Record<string, unknown>;
export type LocatedObject = { value: AnyRecord; path: string };

export const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const numberValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const recordValue = (value: unknown): AnyRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as AnyRecord)
    : null;

export function firstString(object: AnyRecord, keys: string[]): string | null {
  for (const key of keys) {
    const result = stringValue(object[key]);
    if (result) return result;
  }
  return null;
}

export function collectObjects(payloads: unknown[]): LocatedObject[] {
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

export function objectHint(located: LocatedObject): string {
  const object = located.value;
  return [located.path, object.$type, object.__typename, object.entityUrn, object.trackingUrn]
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

export function dateRange(object: AnyRecord): DateRange | null {
  const timePeriod = recordValue(object.timePeriod) ?? recordValue(object.dateRange);
  const start = yearMonth(timePeriod?.startDate ?? object.startDate);
  const end = yearMonth(timePeriod?.endDate ?? object.endDate);
  if (!start && !end) return null;
  return { start, end, isCurrent: Boolean(start && !end) };
}

export function linkedInEntityUrl(object: AnyRecord): string | null {
  const direct = firstString(object, ["url", "companyUrl", "schoolUrl"]);
  if (direct?.startsWith("https://")) return direct;

  const publicIdentifier = firstString(object, [
    "companyPublicIdentifier",
    "schoolPublicIdentifier"
  ]);
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
    .sort((left, right) => (numberValue(right.width) ?? 0) - (numberValue(left.width) ?? 0))[0];
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

export function findImage(object: AnyRecord, keys: string[]): string | null {
  for (const key of keys) {
    const value = object[key];
    const direct = stringValue(value);
    if (direct?.startsWith("http")) return direct;

    const image = nestedImage(value);
    if (image) return image;
  }
  return null;
}

export function dedupe<T>(values: T[], key: (value: T) => string): T[] {
  const keys = new Set<string>();
  return values.filter((value) => {
    const current = key(value).toLowerCase();
    if (!current || keys.has(current)) return false;
    keys.add(current);
    return true;
  });
}
