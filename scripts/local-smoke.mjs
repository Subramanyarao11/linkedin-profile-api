import assert from "node:assert/strict";
import { buildApp } from "../dist/app.js";
import { loadConfig } from "../dist/config.js";
import { ScrapeError } from "../dist/errors.js";

const config = loadConfig({
  NODE_ENV: "production",
  API_KEYS: "smoke-key-one,smoke-key-two",
  REQUESTS_PER_MINUTE: "100",
  LOG_LEVEL: "silent"
});

const unavailableService = {
  async get() {
    throw new ScrapeError(
      "authentication_required",
      "No LinkedIn session is configured for this smoke test.",
      503
    );
  }
};

async function listen(app) {
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  return address.replace(/\/$/, "");
}

async function read(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function runMainChecks() {
  const app = await buildApp(config, unavailableService);
  const base = await listen(app);
  let assertions = 0;

  const request = async (path, options = {}) => {
    const response = await fetch(base + path, options);
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: await read(response)
    };
  };
  const post = (payload, key, extraHeaders = {}) =>
    request("/v1/profiles", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { "x-api-key": key } : {}),
        ...extraHeaders
      },
      body: JSON.stringify(payload)
    });

  try {
    const health = await request("/health");
    assert.equal(health.status, 200); assertions += 1;
    assert.deepEqual(health.body, { status: "ok", linkedInSessionConfigured: false }); assertions += 1;

    const docs = await request("/docs/");
    assert.equal(docs.status, 200); assertions += 1;
    assert.match(docs.contentType, /text\/html/); assertions += 1;

    const spec = await request("/docs/json");
    assert.equal(spec.status, 200); assertions += 1;
    assert.equal(spec.body.openapi, "3.0.3"); assertions += 1;
    assert.ok(spec.body.paths["/v1/profiles"].post.responses["200"]); assertions += 1;
    assert.equal(spec.body.components.securitySchemes.apiKey.name, "x-api-key"); assertions += 1;

    const noKey = await post({ url: "https://www.linkedin.com/in/demo-person/" });
    assert.equal(noKey.status, 401); assertions += 1;
    assert.equal(noKey.body.error.code, "unauthorized"); assertions += 1;

    for (const unsafeUrl of [
      "https://example.com/in/demo-person/",
      "http://www.linkedin.com/in/demo-person/",
      "https://www.linkedin.com/company/example/"
    ]) {
      const invalid = await post({ url: unsafeUrl }, "smoke-key-one");
      assert.equal(invalid.status, 400); assertions += 1;
      assert.equal(invalid.body.error.code, "invalid_profile_url"); assertions += 1;
    }

    const invalidBody = await post({}, "smoke-key-one");
    assert.equal(invalidBody.status, 400); assertions += 1;
    assert.equal(invalidBody.body.error.code, "invalid_request"); assertions += 1;

    const noSession = await post(
      { url: "https://in.linkedin.com/in/demo-person/?trk=smoke" },
      "smoke-key-two",
      { "x-request-id": "local-smoke-id" }
    );
    assert.equal(noSession.status, 503); assertions += 1;
    assert.equal(noSession.body.error.code, "authentication_required"); assertions += 1;
    assert.equal(noSession.body.error.requestId, "local-smoke-id"); assertions += 1;
  } finally {
    await app.close();
  }

  return assertions;
}

async function runRateLimitCheck() {
  const limitedConfig = loadConfig({
    NODE_ENV: "production",
    API_KEYS: "rate-key",
    REQUESTS_PER_MINUTE: "2",
    LOG_LEVEL: "silent"
  });
  const app = await buildApp(limitedConfig, unavailableService);
  const base = await listen(app);

  try {
    const responses = [];
    for (let index = 0; index < 3; index += 1) {
      const response = await fetch(`${base}/health`);
      responses.push({ status: response.status, body: await read(response) });
    }
    assert.deepEqual(responses.map(({ status }) => status), [200, 200, 429]);
    assert.equal(responses[2].body.error.code, "rate_limit_exceeded");
    return 2;
  } finally {
    await app.close();
  }
}

const mainAssertions = await runMainChecks();
const rateAssertions = await runRateLimitCheck();
console.log(`Local HTTP smoke test passed (${mainAssertions + rateAssertions} assertions).`);
