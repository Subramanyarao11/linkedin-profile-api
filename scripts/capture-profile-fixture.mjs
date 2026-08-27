import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const profileUrl = process.env.PROFILE_URL ?? "https://www.linkedin.com/in/satyanadella/";
const storageStatePath = process.env.LINKEDIN_STORAGE_STATE_PATH ?? "storage-state.json";
const outputPath = process.env.FIXTURE_OUTPUT ?? "work/current-profile-dom.json";

if (!/^https:\/\/([a-z]+\.)?linkedin\.com\/in\//i.test(profileUrl)) {
  throw new Error("PROFILE_URL must be an HTTPS LinkedIn /in/ URL");
}

const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
const context = await browser.newContext({
  storageState: storageStatePath,
  viewport: { width: 1440, height: 1200 }
});
const page = await context.newPage();

try {
  const response = await page.goto(profileUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(2_000);

  const blocked = await page.evaluate(() => {
    const text = (document.body?.innerText ?? "").toLowerCase();
    return {
      path: location.pathname,
      challenge: text.includes("security verification") || text.includes("verify your identity"),
      auth: /\/(login|authwall|signup)\b/i.test(location.pathname)
    };
  });
  if (blocked.challenge) throw new Error("LinkedIn requires manual security verification");
  if (blocked.auth) throw new Error("LinkedIn session is not authenticated");

  for (const ratio of [0.25, 0.5, 0.75, 0.95]) {
    await page.evaluate((value) => window.scrollTo(0, document.body.scrollHeight * value), ratio);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(500);

  const snapshot = await page.evaluate(() => {
    const lines = (element) =>
      (element?.innerText ?? "")
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);
    const linkedInPath = (anchor) => {
      try {
        const url = new URL(anchor.href);
        return url.hostname.endsWith("linkedin.com") ? url.pathname : null;
      } catch {
        return null;
      }
    };

    const main = document.querySelector("main");
    const sections = Array.from(document.querySelectorAll("main section")).map((section, index) => ({
      index,
      heading: (section.querySelector("h2, h3")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      lines: lines(section),
      items: Array.from(section.querySelectorAll("li")).map((item) => lines(item)),
      links: Array.from(section.querySelectorAll("a"))
        .map((anchor) => ({ text: lines(anchor).slice(0, 3), path: linkedInPath(anchor) }))
        .filter((link) => link.text.length || link.path)
    }));

    return {
      documentTitle: document.title,
      mainTopLines: lines(main).slice(0, 40),
      sections
    };
  });

  await context.storageState({ path: storageStatePath });
  mkdirSync(new URL(".", new URL(outputPath, `file://${process.cwd()}/`)), { recursive: true });
  writeFileSync(
    outputPath,
    `${JSON.stringify({ capturedAt: new Date().toISOString(), httpStatus: response?.status() ?? null, ...snapshot }, null, 2)}\n`,
    { mode: 0o600 }
  );
  console.log(
    JSON.stringify({
      status: response?.status() ?? null,
      sectionCount: snapshot.sections.length,
      itemCount: snapshot.sections.reduce((sum, section) => sum + section.items.length, 0),
      outputPath
    })
  );
} finally {
  await context.close();
  await browser.close();
}
