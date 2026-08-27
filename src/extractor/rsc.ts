import { load } from "cheerio";

type AnyRecord = Record<string, unknown>;

export type FlightRecords = Map<string, unknown>;

export type AsyncComponentRequest = {
  newComponentId: string;
  requestedArguments?: {
    payload?: unknown;
    requestMetadata?: unknown;
    requestedStateKeys?: unknown[];
  };
};

export function parseFlightRecords(stream: string): FlightRecords {
  const records: FlightRecords = new Map();

  for (const line of stream.split("\n")) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;

    const id = line.slice(0, separator);
    const payload = line.slice(separator + 1);
    if (!/^[0-9a-f]+$/i.test(id) || !payload || /^[A-Z]/.test(payload)) continue;

    try {
      records.set(id.toLowerCase(), JSON.parse(payload));
    } catch {
      // RSC also supports binary and raw-text rows. Profile component metadata
      // and rendered text currently arrive as ordinary JSON rows.
    }
  }

  return records;
}

export function parseHydrationRecords(html: string): FlightRecords {
  const $ = load(html);
  const script = $("#rehydrate-data").html();
  if (!script) return new Map();

  const assignment = script.slice(script.indexOf("=") + 1).trim().replace(/;\s*$/, "");
  try {
    const chunks = JSON.parse(assignment) as unknown;
    if (!Array.isArray(chunks) || !chunks.every((chunk) => typeof chunk === "string")) {
      return new Map();
    }
    return parseFlightRecords(chunks.join(""));
  } catch {
    return new Map();
  }
}

export function findAsyncComponent(
  records: FlightRecords,
  componentId: string
): AsyncComponentRequest | null {
  let match: AsyncComponentRequest | null = null;
  walkValues([...records.values()], (value) => {
    if (match || !isRecord(value) || value.newComponentId !== componentId) return;
    match = value as AsyncComponentRequest;
  });
  return match;
}

export function collectCardText(
  records: FlightRecords,
  componentKeySuffix: string
): string[] {
  let card: AnyRecord | null = null;

  walkValues([...records.values()], (value) => {
    if (card || !isRecord(value)) return;
    const componentKey = value.componentkey ?? value.componentKey;
    if (typeof componentKey === "string" && componentKey.endsWith(componentKeySuffix)) {
      card = value;
    }
  });

  if (!card) return [];
  const text: string[] = [];
  collectRenderedText(card, records, text, new Set());
  return dedupe(text.map(cleanText).filter(Boolean));
}

function collectRenderedText(
  value: unknown,
  records: FlightRecords,
  output: string[],
  visitedReferences: Set<string>
): void {
  const resolved = resolveReference(value, records, visitedReferences);
  if (typeof resolved === "string") {
    if (!resolved.startsWith("$")) output.push(resolved);
    return;
  }
  if (!resolved || typeof resolved !== "object") return;

  if (Array.isArray(resolved)) {
    if (resolved[0] === "$" && isRecord(resolved[3])) {
      collectRenderableProps(resolved[3], records, output, visitedReferences);
      return;
    }
    for (const child of resolved) collectRenderedText(child, records, output, visitedReferences);
    return;
  }

  if (!isRecord(resolved)) return;
  collectRenderableProps(resolved, records, output, visitedReferences);
}

function collectRenderableProps(
  props: AnyRecord,
  records: FlightRecords,
  output: string[],
  visitedReferences: Set<string>
): void {
  if (isRecord(props.textProps)) {
    collectRenderedText(props.textProps.children, records, output, visitedReferences);
  }
  for (const key of ["children", "initialContent", "content"] as const) {
    collectRenderedText(props[key], records, output, visitedReferences);
  }
}

function resolveReference(
  value: unknown,
  records: FlightRecords,
  visitedReferences: Set<string>
): unknown {
  if (typeof value !== "string") return value;

  const match = value.match(/^\$L?([0-9a-f]+)(?::(.+))?$/i);
  if (!match?.[1]) return value;

  const referenceKey = value.toLowerCase();
  if (visitedReferences.has(referenceKey)) return undefined;
  visitedReferences.add(referenceKey);

  let resolved = records.get(match[1].toLowerCase());
  for (const segment of match[2]?.split(":") ?? []) {
    resolved = isRecord(resolved) || Array.isArray(resolved) ? resolved[segment as never] : undefined;
  }
  return resolved;
}

function walkValues(values: unknown[], visitor: (value: unknown) => void): void {
  const seen = new Set<object>();

  const visit = (value: unknown): void => {
    visitor(value);
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    for (const child of Object.values(value)) visit(child);
  };

  for (const value of values) visit(value);
}

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
