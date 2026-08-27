# LinkedIn Profile API

A production-shaped HTTP API and server-rendered demo interface that accept a LinkedIn `/in/...` profile URL and return the profile fields visible to a LinkedIn session you control as structured JSON.

The service opens the profile in Chromium, observes the JSON responses used by LinkedIn's own page, normalizes recognizable profile entities, and falls back to JSON-LD/visible DOM data. It does **not** bypass login, profile visibility, CAPTCHA, MFA, checkpoints, or rate limits.

> [!IMPORTANT]
> LinkedIn's official APIs do not provide the complete arbitrary-profile access described by this challenge. Automated collection may be restricted by the [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) and local law. Use this project only with accounts, profiles, and purposes you are authorized to access. For consent-based data about the currently signed-in member, prefer LinkedIn's [official developer products](https://learn.microsoft.com/en-us/linkedin/).

## What it returns

- A zero-friction web form at `/` plus the JSON API and interactive OpenAPI docs
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

The assignment demo is public by default, so callers do not need an API key. To protect a private deployment instead, set `API_ACCESS_MODE=api-key`, generate a key, and place it in `.env`:

```bash
openssl rand -hex 32
```

Set `API_KEYS` to that generated value only in API-key mode. Then configure a LinkedIn session using one of the methods below and run:

```bash
npm run dev
```

Open `http://localhost:3000/` for the profile form, `http://localhost:3000/docs` for interactive OpenAPI documentation, or `http://localhost:3000/health` for health status.

## Evaluator workflow

The public assignment deployment asks the evaluator for exactly one value: a LinkedIn profile URL. They can paste it into `/` or call the endpoint directly. LinkedIn credentials remain exclusively in the backend.

For private reuse, change `API_ACCESS_MODE` to `api-key`; the same landing form then displays an API-key field and the OpenAPI operation documents the `x-api-key` requirement.

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
```

Add `x-api-key: <one of API_KEYS>` only when `API_ACCESS_MODE=api-key`.

Request:

```json
{
  "url": "https://www.linkedin.com/in/satyanadella/",
  "refresh": false
}
```

`url` must be an HTTPS LinkedIn `/in/{publicIdentifier}` URL. Host and path validation prevent the browser from being used for SSRF. `refresh: true` bypasses a successful cached result.

For account safety, `refresh` is honored only in API-key mode. Public callers always receive a valid cached result when one exists.

Example:

```bash
curl --request POST 'http://localhost:3000/v1/profiles' \
  --header 'content-type: application/json' \
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
| `401` | `unauthorized` (API-key mode only) |
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
3. Playwright loads and scrolls the profile while collecting JSON responses from LinkedIn's first-party `voyager/api` and GraphQL requests. When enabled, it then visits LinkedIn's standard visible experience, education, skills, certifications, and languages detail pages sequentially. It does not replay hidden requests or bypass access controls.
4. The normalizer detects profile, position, education, skill, certification, language, and vector-image entity shapes. JSON-LD and visible DOM fields fill gaps, and target-identity matching prevents navigation data for the signed-in viewer from overriding the requested profile.
5. Results are cached in memory. A small FIFO semaphore limits concurrent browser contexts for account safety and predictable memory use.

The normalizer is intentionally defensive: unknown entities are ignored, duplicate entries are collapsed, absent dates remain `null`, and sparse responses include warnings with `source.partial: true`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port assigned by the platform |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Runtime environment |
| `API_ACCESS_MODE` | `public` | `public` for URL-only access or `api-key` for protected access |
| `API_KEYS` | empty | Comma-separated accepted API keys |
| `LINKEDIN_STORAGE_STATE_JSON` | empty | One-line Playwright storage state |
| `LINKEDIN_STORAGE_STATE_PATH` | empty | Local path to a Playwright storage-state file |
| `LINKEDIN_STORAGE_STATE_SEED_PATH` | empty | Read-only seed file used when the writable state path does not exist |
| `LINKEDIN_LI_AT` | empty | LinkedIn session cookie |
| `LINKEDIN_JSESSIONID` | empty | Optional LinkedIn CSRF/session cookie |
| `ALLOW_GUEST_MODE` | `false` | Permit extraction with no session |
| `INCLUDE_DETAIL_PAGES` | `true` | Visit standard visible detail pages for fuller results |
| `REQUESTS_PER_MINUTE` | `10` | Per-IP profile-request limit; docs and health are excluded |
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

The included `render.yaml` deploys the Docker image in Render's Singapore region as a Free web service with managed HTTPS, URL-only public access, strict per-IP request limits, one-at-a-time extraction, and health checks. Change the region in the Blueprint before creation if Singapore is not appropriate for your deployment.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Subramanyarao11/linkedin-profile-api)

1. Suspend unused Free services if necessary, click **Deploy to Render**, and create the Free Blueprint.
2. When prompted, set `LINKEDIN_STORAGE_STATE_JSON` to the one-line output of `jq -c . storage-state.json`. Do not put its value in `render.yaml`.
3. Open `https://<service-name>.onrender.com/`, paste a profile URL, and verify the rendered result.
4. Call `https://<service-name>.onrender.com/health`, then test the URL-only `POST /v1/profiles` endpoint or `/docs`.

Free services have an ephemeral filesystem and spin down when idle, so each new instance starts from the encrypted JSON seed. Cookie changes remain in the shared browser context while that instance is alive, but are lost on restart. If the seed stops authenticating, recapture it locally and replace the Render secret. For a more durable private deployment, upgrade to a paid instance, attach a persistent disk, and point `LINKEDIN_STORAGE_STATE_PATH` at that disk.

Automatic deploys are disabled to avoid replacing a stable scraper when a dependency or profile shape changes. Deploy reviewed commits manually.

The Docker image also runs on Fly.io, Railway, Cloud Run, ECS/Fargate, or any container platform with at least roughly 1 GB RAM, outbound HTTPS, encrypted secrets, and a platform TLS endpoint.

## Known limitations

- LinkedIn's page response schemas and DOM are undocumented and can change without notice. Fixture tests detect regressions only after a new shape is added.
- Results depend on what the configured account can see, the profile owner's privacy settings, account locale, experiments, and which sections the page loads. Hidden data is not accessible.
- Sessions expire and may trigger a checkpoint. The API returns `authentication_required` or `challenge_required`; it intentionally does not solve CAPTCHA/MFA or automate challenge recovery.
- Standard detail pages add sequential page loads and response time. Set `INCLUDE_DETAIL_PAGES=false` when lower latency is more important than completeness.
- A Free Render instance can take about a minute to wake after idling and does not preserve rotated session state across restarts.
- A successful sparse extraction returns HTTP `200` with `source.partial: true` and human-readable `meta.warnings`.
- Image URLs may be resized, signed, or temporary. Store them only if your use and LinkedIn's terms permit it.
- The cache is per process. Multiple replicas need a shared cache and distributed concurrency/rate limits before they should share one LinkedIn account.
- Running a public scraper can expose the backing account to abuse. The assignment configuration disables public cache bypass, limits requests per IP, and serializes extraction; use API-key mode and stronger external quotas for any long-lived deployment.
- This implementation makes no guarantee of continuous LinkedIn compatibility or suitability for bulk collection.

## Repository structure

```text
src/
  app.ts                    Fastify composition root
  config.ts                 Validated environment configuration
  http/
    api-error.ts            Consistent API error translation
    api-key.ts              Constant-time API-key guard
    plugins.ts              Helmet, rate-limit, and OpenAPI setup
    routes/                 Evaluator, health, and profile routes
    schemas.ts              JSON/OpenAPI request and response schemas
  ui.ts                     Server-rendered evaluator interface
  extractor/
    browser.ts              High-level authenticated scrape workflow
    dom-snapshot.ts         Browser-side DOM snapshot capture
    network-capture.ts      First-party JSON response collection
    storage-state.ts        Session-state resolution and browser context
    normalize.ts            Entity-to-response orchestration
    normalization/          DOM and payload normalization helpers
  profile-url.ts            Strict URL canonicalization / SSRF guard
  scrape-service.ts         Bounded concurrency and cache
  server.ts                 Runtime construction and graceful shutdown
tests/                      Synthetic fixtures and unit/API tests
Dockerfile                  Multi-stage production container
render.yaml                 Render Blueprint (secrets stay external)
```

## License

MIT. LinkedIn is a trademark of LinkedIn Corporation. This project is independent and is not endorsed by LinkedIn.
