# LinkedIn Profile API

A Node.js HTTP API and server-rendered evaluator UI that accept a LinkedIn `/in/...` profile URL and return the profile information visible to a configured LinkedIn account as structured JSON.

The extraction runtime is **pure HTTP**. It does not launch, control, or depend on a browser. It directly requests LinkedIn's current server-rendered profile/detail pages and the first-party React Server Component (RSC) endpoint advertised in the profile response.

> [!IMPORTANT]
> LinkedIn's official APIs do not provide the complete arbitrary-profile access described by this challenge. Automated collection may be restricted by the [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) and applicable law. Use this project only with accounts, profiles, and purposes you are authorized to access. The service does not bypass login, visibility rules, CAPTCHA, MFA, checkpoints, or rate limits.

## Assignment coverage

- Public-ready HTTPS deployment configuration for Render
- URL-only evaluator workflow at `/`
- `POST /v1/profiles` accepts a LinkedIn profile URL
- Name, headline, location, about, experience, education, skills, certifications, languages, and profile images when LinkedIn returns them
- Direct authenticated HTTP requests—no Playwright, Selenium, Puppeteer, Chromium, or other browser runtime
- Validated inputs, bounded concurrency, caching, per-IP rate limiting, consistent errors, OpenAPI docs, tests, and a production Docker image
- Credentials supplied only through environment secrets

Unavailable fields are returned as `null` or `[]`; the API never invents profile data. Sparse successful results include warnings and `source.partial: true`.

## Quick start

Prerequisites: Node.js 22+ and npm.

```bash
git clone https://github.com/Subramanyarao11/linkedin-profile-api.git
cd linkedin-profile-api
npm ci
cp .env.example .env
```

Add `LINKEDIN_LI_AT` and `LINKEDIN_JSESSIONID` to `.env`, then run:

```bash
npm run dev
```

Open:

- `http://localhost:3000/` — evaluator form
- `http://localhost:3000/docs` — interactive OpenAPI documentation
- `http://localhost:3000/health` — process/session-configuration health

## LinkedIn session configuration

Both cookies are required by the direct HTTP flow:

```dotenv
LINKEDIN_LI_AT=your_li_at_value
LINKEDIN_JSESSIONID="ajax:your_value"
```

To obtain them from a LinkedIn session you own:

1. Sign in to LinkedIn normally.
2. Open DevTools, then **Application → Storage → Cookies → https://www.linkedin.com**.
3. Copy the values of `li_at` and `JSESSIONID` into your local `.env` or hosting provider's encrypted secret fields.
4. Preserve the quotes around `JSESSIONID` if DevTools shows them.

These values are equivalent to credentials. Never paste them into source, logs, issues, screenshots, or Git commits. `.env` and `storage-state.json` are gitignored, but environment secrets are the supported runtime configuration.

The session can expire or be invalidated. Replace the two secrets after signing in manually again; the service intentionally does not automate login or checkpoint recovery.

## Evaluator workflow

The assignment configuration uses `API_ACCESS_MODE=public`. An evaluator only provides a LinkedIn profile URL through the landing page or API; the backend session remains private.

For a non-demo deployment, set `API_ACCESS_MODE=api-key`, generate a secret, and set `API_KEYS` to one or more comma-separated values:

```bash
openssl rand -hex 32
```

Clients then send the selected value as `x-api-key`. Public mode disables caller-requested cache bypass, limiting unnecessary requests to LinkedIn.

## API

### `POST /v1/profiles`

Request:

```json
{
  "url": "https://www.linkedin.com/in/satyanadella/",
  "refresh": false
}
```

The URL must be HTTPS and point to `linkedin.com/in/{publicIdentifier}`. It is canonicalized to `www.linkedin.com`; the strict host and path check prevents arbitrary server-side requests.

```bash
curl --request POST 'http://localhost:3000/v1/profiles' \
  --header 'content-type: application/json' \
  --data '{"url":"https://www.linkedin.com/in/satyanadella/"}'
```

Example response (values shortened; this documents the schema, not the current profile contents):

```json
{
  "data": {
    "source": {
      "profileUrl": "https://www.linkedin.com/in/satyanadella/",
      "publicIdentifier": "satyanadella",
      "fetchedAt": "2026-08-27T07:30:00.000Z",
      "extractionMode": ["html", "rsc"],
      "partial": true
    },
    "name": { "full": "Satya Nadella", "first": "Satya", "last": "Nadella" },
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
        "description": null,
        "dateRange": {
          "start": { "year": 2014, "month": 2 },
          "end": null,
          "isCurrent": true
        }
      }
    ],
    "education": [],
    "skills": [],
    "certifications": [],
    "languages": [],
    "profileImages": { "profile": "https://media.licdn.com/...", "background": null }
  },
  "meta": {
    "requestId": "req-1",
    "durationMs": 900,
    "cache": "miss",
    "warnings": [
      "No education entries were available or recognized.",
      "No skills were available or recognized.",
      "No certifications were available or recognized.",
      "No languages were available or recognized."
    ]
  }
}
```

`refresh: true` bypasses a successful cached result only in API-key mode. Public callers receive a valid cached result when one exists.

### Errors

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
| `401` | `unauthorized` (API-key mode) |
| `404` | `profile_not_found` |
| `429` | `rate_limit_exceeded` |
| `502` | `profile_unavailable`, `extraction_failed` |
| `503` | `authentication_required`, `challenge_required` |
| `504` | `scrape_timeout` |

### `GET /health`

Returns process health and whether both session cookies were configured. It does not validate or expose the values:

```json
{ "status": "ok", "linkedInSessionConfigured": true }
```

## Reverse-engineered extraction approach

1. The input parser accepts only a LinkedIn HTTPS `/in/{id}` URL and produces a fixed canonical origin.
2. The client sends `li_at`, `JSESSIONID`, and the corresponding CSRF token directly with a `GET` for the profile page. Redirects are not followed, so login/auth-wall/checkpoint responses can be classified safely.
3. LinkedIn's current profile response contains a `rehydrate-data` React Flight stream. The parser reads the async request metadata for `profileCardsAboveActivity` rather than relying on an obsolete Voyager `profileView` route or hard-coded GraphQL query ID.
4. The service sends that discovered payload directly to LinkedIn's first-party `/flagship-web/rsc-action/actions/component` endpoint and extracts the rendered About card from its RSC stream.
5. When enabled, ordinary HTTP `GET` requests load the profile's `details/experience`, `education`, `skills`, `certifications`, and `languages` routes sequentially. Cheerio parses their server-rendered HTML.
6. The normalizer maps recognizable entries to the stable public schema, collapses duplicates, parses date ranges, and emits warnings for fields LinkedIn omitted or whose current shape was not recognized.
7. Results are cached in memory, while a FIFO semaphore serializes direct extraction by default.

No client-side JavaScript is executed. There is no user-agent impersonation, fingerprint manipulation, timing jitter, challenge solver, or automated sign-in.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Runtime environment |
| `API_ACCESS_MODE` | `public` | URL-only public access or protected `api-key` access |
| `API_KEYS` | empty | Comma-separated accepted API keys |
| `LINKEDIN_LI_AT` | empty | Required LinkedIn authenticated-session cookie |
| `LINKEDIN_JSESSIONID` | empty | Required LinkedIn session/CSRF cookie |
| `INCLUDE_DETAIL_PAGES` | `true` | Request the five standard detail routes |
| `REQUESTS_PER_MINUTE` | `10` | Per-IP profile-request limit |
| `SCRAPE_TIMEOUT_MS` | `45000` | Timeout for each outbound LinkedIn request |
| `SCRAPE_CONCURRENCY` | `1` | Concurrent extraction workflows (maximum `3`) |
| `PROFILE_CACHE_TTL_SECONDS` | `900` | Successful-result TTL; `0` disables caching |
| `MAX_CACHE_ENTRIES` | `250` | In-memory cache bound |
| `LOG_LEVEL` | `info` | Pino log level |

## Tests and production build

```bash
npm run check
npm audit --omit=dev
docker build -t linkedin-profile-api .
docker run --rm -p 3000:3000 --env-file .env linkedin-profile-api
```

Tests use synthetic HTML/RSC fixtures and mocked HTTP responses; they do not contact LinkedIn. `npm run check` type-checks, runs the unit/API tests, builds the production output, and exercises the built Fastify service and rate limiter over a real local TCP socket. CI repeats the complete check, production dependency audit, and Docker build.

## HTTPS deployment on Render

The included `render.yaml` defines a Free Docker web service with Render-managed HTTPS, a `/health` check, public URL-only evaluation, a strict request rate, serialized extraction, and manual deploys.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Subramanyarao11/linkedin-profile-api)

1. Click **Deploy to Render** and create the Blueprint.
2. Supply `LINKEDIN_LI_AT` and `LINKEDIN_JSESSIONID` in Render's encrypted secret prompts. Do not add their values to `render.yaml`.
3. Open `https://<service-name>.onrender.com/`, paste a profile URL, and inspect the structured response.
4. Verify `/health`, `/docs`, and `POST /v1/profiles`.

Free services sleep while idle, so the first request after inactivity can be slow. Automatic deploys are disabled so a reviewed, working extraction version is not replaced unexpectedly. Other container hosts work if they provide outbound HTTPS, encrypted secrets, and TLS termination.

## Known limitations

- LinkedIn's HTML and RSC formats are private and can change without notice. A format change can require parser maintenance.
- Results are limited to what the configured account can see and vary with privacy settings, locale, experiments, and the sections a member has populated.
- Some detail routes may return an empty server-rendered card even when another LinkedIn client surface displays the section; the API reports the result as partial instead of guessing.
- Session cookies expire and can trigger login or a checkpoint. The API reports this and requires manual session renewal.
- Each uncached full extraction can make up to seven sequential LinkedIn requests: profile HTML, About RSC, and five detail routes. Disable detail pages or increase cache TTL to reduce traffic.
- Image URLs can be resized, signed, or temporary.
- The cache and concurrency control are per process. Multiple replicas need shared coordination before using one backing account.
- A public endpoint can expose the backing account to abuse. Public mode disables cache bypass and the sample deployment applies low rate limits; use API-key mode and stronger external quotas for a long-lived service.
- Continuous LinkedIn compatibility and suitability for bulk collection are not guaranteed.

## Repository structure

```text
src/
  app.ts                       Fastify composition root
  config.ts                    Validated environment configuration
  http/                        Auth, routes, OpenAPI schemas, error mapping
  ui.ts                        Server-rendered evaluator interface
  extractor/
    linkedin-http.ts           Direct authenticated HTTP workflow
    html-snapshot.ts           Server-rendered HTML parsing and merging
    rsc.ts                     React Flight hydration/component parser
    normalize.ts               Stable response-schema orchestration
    normalization/             Entity, HTML, dates, images, and value helpers
  profile-url.ts               Strict URL canonicalization and SSRF guard
  scrape-service.ts            Bounded concurrency and in-memory cache
  server.ts                    Runtime construction and graceful shutdown
tests/                         Synthetic fixtures and unit/integration tests
Dockerfile                     Multi-stage Node.js production container
render.yaml                    Render Blueprint; secret values stay external
```

## License

MIT. LinkedIn is a trademark of LinkedIn Corporation. This project is independent and is not endorsed by LinkedIn.
