import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { ScrapeError } from "../src/errors.js";
import { resolveStorageState } from "../src/extractor/storage-state.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function temporaryPath(filename: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "linkedin-storage-state-"));
  temporaryDirectories.push(directory);
  return join(directory, filename);
}

describe("resolveStorageState", () => {
  it("prefers an existing writable state over all seeds", async () => {
    const writablePath = await temporaryPath("writable.json");
    const seedPath = await temporaryPath("seed.json");
    writeFileSync(writablePath, "{}");
    writeFileSync(seedPath, "{}");
    const config = loadConfig({
      LINKEDIN_STORAGE_STATE_PATH: writablePath,
      LINKEDIN_STORAGE_STATE_SEED_PATH: seedPath,
      LINKEDIN_STORAGE_STATE_JSON: '{"cookies":[]}'
    });

    expect(resolveStorageState(config)).toBe(writablePath);
  });

  it("uses a read-only seed when the writable state does not exist", async () => {
    const writablePath = await temporaryPath("missing.json");
    const seedPath = await temporaryPath("seed.json");
    writeFileSync(seedPath, "{}");
    const config = loadConfig({
      LINKEDIN_STORAGE_STATE_PATH: writablePath,
      LINKEDIN_STORAGE_STATE_SEED_PATH: seedPath,
      LINKEDIN_STORAGE_STATE_JSON: '{"cookies":[]}'
    });

    expect(resolveStorageState(config)).toBe(seedPath);
  });

  it("falls back to a JSON seed when configured files do not exist", async () => {
    const writablePath = await temporaryPath("missing.json");
    const config = loadConfig({
      LINKEDIN_STORAGE_STATE_PATH: writablePath,
      LINKEDIN_STORAGE_STATE_JSON: '{"cookies":[],"origins":[]}'
    });

    expect(resolveStorageState(config)).toEqual({ cookies: [], origins: [] });
  });

  it("rejects malformed JSON state", () => {
    const config = loadConfig({ LINKEDIN_STORAGE_STATE_JSON: "not-json" });

    expect(() => resolveStorageState(config)).toThrowError(ScrapeError);
    expect(() => resolveStorageState(config)).toThrow("LINKEDIN_STORAGE_STATE_JSON is not valid JSON");
  });

  it("rejects missing configured files without another seed", async () => {
    const seedPath = await temporaryPath("missing.json");
    const config = loadConfig({ LINKEDIN_STORAGE_STATE_SEED_PATH: seedPath });

    expect(() => resolveStorageState(config)).toThrowError(ScrapeError);
    expect(() => resolveStorageState(config)).toThrow("does not exist");
  });
});
