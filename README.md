# LinkedIn Profile API

A production-shaped HTTP API that accepts a LinkedIn `/in/...` profile URL and returns the profile fields visible to a LinkedIn session you control as structured JSON.

The service opens the profile in Chromium, observes the JSON responses used by LinkedIn's own page, normalizes recognizable profile entities, and falls back to JSON-LD/visible DOM data. It does **not** bypass login, profile visibility, CAPTCHA, MFA, checkpoints, or rate limits.

> [!IMPORTANT]
> LinkedIn's official APIs do not provide the complete arbitrary-profile access described by this challenge. Automated collection may be restricted by the [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) and local law. Use this project only with accounts, profiles, and purposes you are authorized to access. For consent-based data about the currently signed-in member, prefer LinkedIn's [official developer products](https://learn.microsoft.com/en-us/linkedin/).

## What it returns

- Name, headline, location, and about
- Experience and education with normalized date ranges
- Skills and endorsement counts when present
- Certifications and languages
- Profile/background image URLs when present
- Source URL, extraction mode, partial-result flag, cache status, and warnings

Every field that LinkedIn hides, omits, or no longer includes is returned as `null`/`[]`; it is never guessed.

## Quick start

Prerequisites: Node.js 22+, npm, and Chromium for Playwright.

```bash
git clone https://github.com/Subramanyarao11/linkedin-profile-api.git
cd linkedin-profile-api
npm ci
npx playwright install chromium
cp .env.example .env
```

Generate an API key and place it in `.env`:

```bash
openssl rand -hex 32
```

Set `API_KEYS` to that generated value. Then configure a LinkedIn session using one of the methods below and run:

```bash
npm run dev
```

Open `http://localhost:3000/docs` for interactive OpenAPI documentation or `http://localhost:3000/health` for health status.

## Configure the LinkedIn session

Session material is equivalent to a password. Use a dedicated, authorized account where appropriate, restrict who can read deployment secrets, rotate it regularly, and never commit it.

### Option A: Playwright storage state (recommended)

Capture a session interactively on your own machine:

```bash
npx playwright codegen --save-storage=storage-state.json https://www.linkedin.com/login
```

Sign in in the opened browser and close it after LinkedIn finishes loading. `storage-state.json` is gitignored. For local testing, put its path in `.env`:

```dotenv
LINKEDIN_STORAGE_STATE_PATH=storage-state.json
```

For a remote host that cannot mount the file, convert it to one line with `jq -c . storage-state.json` and store the result as the encrypted `LINKEDIN_STORAGE_STATE_JSON` secret.

### Option B: Session cookies

From a LinkedIn browser session you own, supply the `li_at` cookie as `LINKEDIN_LI_AT` and, if available, the `JSESSIONID` cookie as `LINKEDIN_JSESSIONID`. Values belong only in `.env` locally or in your host's encrypted secret manager.

### Guest mode

Set `ALLOW_GUEST_MODE=true` to run without a session. Results will usually be sparse and LinkedIn may show an auth wall. Guest mode is useful for development, not for meeting the full-data requirement.

## API

### `POST /v1/profiles`

Headers:

```text
content-type: application/json
x-api-key: <one of API_KEYS>
```

Request:

```json
{
  "url": "https://www.linkedin.com/in/satyanadella/",
  "refresh": false
}
```

`url` must be an HTTPS LinkedIn `/in/{publicIdentifier}` URL. Host and path validation prevent the browser from being used for SSRF. `refresh: true` bypasses a successful cached result.

Example:

```bash
curl --request POST 'http://localhost:3000/v1/profiles' \
  --header 'content-type: application/json' \
  --header 'x-api-key: replace-with-your-key' \
  --data '{"url":"https://www.linkedin.com/in/satyanadella/"}'
```

Successful response (values shortened):

```json
{
  "data": {
    "source": {
      "profileUrl": "https://www.linkedin.com/in/satyanadella/",
      "publicIdentifier": "satyanadella",
      "fetchedAt": "2026-08-27T07:30:00.000Z",
      "extractionMode": ["network", "dom"],
      "partial": false
    },
    "name": {
      "full": "Satya Nadella",
      "first": "Satya",
      "last": "Nadella"
    },
    "headline": "Chairman and CEO at Microsoft",
    "location": "Redmond, Washington, United States",
    "about": "...",
    "experience": [
      {
        "title": "Chairman and CEO",
        "company": "Microsoft",
        "companyLinkedInUrl": "https://www.linkedin.com/company/microsoft/",
        "employmentType": null,
        "location": null,
        "description": "...",
        "dateRange": {
          "start": { "year": 2014, "month": 2 },
          "end": null,
          "isCurrent": true
        }
      }
    ],
    "education": [],
    "skills": [{ "name": "Leadership", "endorsementCount": null }],
    "certifications": [],
    "languages": [{ "name": "English", "proficiency": null }],
    "profileImages": {
      "profile": "https://media.licdn.com/...",
      "background": null
    }
  },
  "meta": {
    "requestId": "req-1",
    "durationMs": 2840,
    "cache": "miss",
    "warnings": []
  }
}
```

This example documents the schema; it is not a claim about the current contents of that profile.

### Errors

All application errors use the same shape:

```json
{
  "error": {
    "code": "authentication_required",
    "message": "The configured LinkedIn session is missing or expired.",
    "requestId": "req-2"
  }
}
```

| Status | Typical codes |
| --- | --- |
| `400` | `invalid_request`, `invalid_profile_url` |
| `401` | `unauthorized` |
| `404` | `profile_not_found` |
| `429` | `rate_limit_exceeded` |
| `502` | `profile_unavailable`, `extraction_failed` |
| `503` | `authentication_required`, `challenge_required` |
| `504` | `scrape_timeout` |

### `GET /health`

Returns process health and whether session material was configured. It never validates or returns the secret:

```json
{
  "status": "ok",
  "linkedInSessionConfigured": true
}
```

## How extraction works

1. The input parser accepts only `https://*.linkedin.com/in/{id}` and canonicalizes it to `www.linkedin.com`.
2. One isolated browser context receives session state from environment variables and remains alive for the process lifetime. Individual requests use fresh pages while LinkedIn cookie rotations remain in the shared context. With `LINKEDIN_STORAGE_STATE_PATH`, a successful non-challenged load also persists rotated state for the next restart.
3. Playwright loads and scrolls the profile while collecting JSON responses from LinkedIn's first-party `voyager/api` and GraphQL requests. It does not call guessed endpoints or replay hidden requests.
4. The normalizer detects profile, position, education, skill, certification, language, and vector-image entity shapes. JSON-LD and visible DOM fields fill basic gaps.
5. Results are cached in memory. A small FIFO semaphore limits concurrent browser contexts for account safety and predictable memory use.

The normalizer is intentionally defensive: unknown entities are ignored, duplicate entries are collapsed, absent dates remain `null`, and sparse responses include warnings with `source.partial: true`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port assigned by the platform |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | `production` requires `API_KEYS` |
| `API_KEYS` | empty | Comma-separated accepted API keys |
| `LINKEDIN_STORAGE_STATE_JSON` | empty | One-line Playwright storage state |
| `LINKEDIN_STORAGE_STATE_PATH` | empty | Local path to a Playwright storage-state file |
| `LINKEDIN_LI_AT` | empty | LinkedIn session cookie |
| `LINKEDIN_JSESSIONID` | empty | Optional LinkedIn CSRF/session cookie |
| `ALLOW_GUEST_MODE` | `false` | Permit extraction with no session |
| `REQUESTS_PER_MINUTE` | `10` | Per-IP request limit |
| `SCRAPE_TIMEOUT_MS` | `45000` | Page navigation timeout |
| `SCRAPE_CONCURRENCY` | `1` | Concurrent browser contexts (max `3`) |
| `PROFILE_CACHE_TTL_SECONDS` | `900` | Successful-result TTL; `0` disables cache |
| `MAX_CACHE_ENTRIES` | `250` | In-memory cache bound |
| `LOG_LEVEL` | `info` | Pino log level |

## Test and build

```bash
npm run check
# Or run only the built-server HTTP checks
npm run smoke
docker build -t linkedin-profile-api .
docker run --rm -p 3000:3000 --env-file .env linkedin-profile-api
```

Tests use invented response fixtures and do not contact LinkedIn. `npm run check` type-checks, runs the unit/API suite, builds the production output, and exercises the built HTTP server plus its rate limiter over a real TCP socket. CI runs that complete check, audits production dependencies, and builds the Docker image.

## HTTPS deployment on Render

The included `render.yaml` deploys the Docker image as a web service with HTTPS, a generated API key, health checks, and secrets entered only in Render.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Subramanyarao11/linkedin-profile-api)

1. Click **Deploy to Render**, select at least the Starter plan (Chromium is generally too memory-heavy for small free instances), and create the Blueprint.
2. In the service's Environment page, set `LINKEDIN_STORAGE_STATE_JSON`, or both LinkedIn cookie variables. Do not put their values in `render.yaml`.
3. Copy the generated `API_KEYS` value from the secret manager for API clients.
4. Call `https://<service-name>.onrender.com/health`, then test `POST /v1/profiles` with `x-api-key`.

`autoDeploy` is off to avoid replacing a stable scraper automatically when a dependency or profile shape changes. Deploy reviewed commits manually.

The Docker image also runs on Fly.io, Railway, Cloud Run, ECS/Fargate, or any container platform with at least roughly 1 GB RAM, outbound HTTPS, encrypted secrets, and a platform TLS endpoint.

## Known limitations

- LinkedIn's page response schemas and DOM are undocumented and can change without notice. Fixture tests detect regressions only after a new shape is added.
- Results depend on what the configured account can see, the profile owner's privacy settings, account locale, experiments, and which sections the page loads. Hidden data is not accessible.
- Sessions expire and may trigger a checkpoint. The API returns `authentication_required` or `challenge_required`; it intentionally does not solve CAPTCHA/MFA or automate challenge recovery.
- A successful sparse extraction returns HTTP `200` with `source.partial: true` and human-readable `meta.warnings`.
- Image URLs may be resized, signed, or temporary. Store them only if your use and LinkedIn's terms permit it.
- The cache is per process. Multiple replicas need a shared cache and distributed concurrency/rate limits before they should share one LinkedIn account.
- Running a public scraper can expose the backing account to abuse. Keep API-key auth enabled, use strict quotas, monitor logs, and rotate both API and LinkedIn session secrets.
- This implementation makes no guarantee of continuous LinkedIn compatibility or suitability for bulk collection.

## Repository structure

```text
src/
  app.ts                    Fastify routes, OpenAPI, auth, rate limiting
  config.ts                 Validated environment configuration
  extractor/browser.ts      Authenticated browser and response capture
  extractor/normalize.ts    LinkedIn entity-to-schema normalization
  profile-url.ts            Strict URL canonicalization / SSRF guard
  scrape-service.ts         Bounded concurrency and cache
tests/                      Synthetic fixtures and unit/API tests
Dockerfile                  Multi-stage production container
render.yaml                 Render Blueprint (secrets stay external)
```

## License

MIT. LinkedIn is a trademark of LinkedIn Corporation. This project is independent and is not endorsed by LinkedIn.
