# LinkedIn Profile API

A Node.js HTTP API and server-rendered evaluator UI that accept a LinkedIn `/in/...` profile URL and return the profile information visible to a configured LinkedIn account as structured JSON.

The extraction runtime is **pure HTTP**. It does not launch, control, or depend on a browser. It sends one authenticated request to LinkedIn's current mobile-web profile endpoint and parses the server-rendered response.

Live evaluator: **https://linkedin-profile-api-eyyc.onrender.com**

> [!IMPORTANT]
> LinkedIn's official APIs do not provide the complete arbitrary-profile access described by this challenge. Automated collection may be restricted by the [LinkedIn User Agreement](https://www.linkedin.com/legal/user-agreement) and applicable law. Use this project only with accounts, profiles, and purposes you are authorized to access. The service does not bypass login, visibility rules, CAPTCHA, MFA, checkpoints, or rate limits.

## Assignment coverage

- Public-ready HTTPS deployment configuration for Render
- URL-only evaluator workflow at `/`
- `POST /v1/profiles` accepts a LinkedIn profile URL
- Name, headline, location, about, experience, education, skills, certifications, languages, and profile images when LinkedIn returns them
- Direct authenticated HTTP requests—no Playwright, Selenium, Puppeteer, Chromium, or other browser runtime
- Protected cached session-readiness verification and an optional scheduled GitHub monitor
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

Add the LinkedIn session variables described below to `.env`, then run:

```bash
npm run dev
```

Open:

- `http://localhost:3000/` — evaluator form
- `http://localhost:3000/docs` — interactive OpenAPI documentation
- `http://localhost:3000/health` — process/session-configuration health

## LinkedIn session configuration

`li_at` and `JSESSIONID` authenticate the account. LinkedIn's current mobile-web profile endpoint also expects the first-party device cookies that accompany that session:

```dotenv
LINKEDIN_LI_AT=your_li_at_value
LINKEDIN_JSESSIONID="ajax:your_value"
LINKEDIN_ADDITIONAL_COOKIES=liap=true; bcookie=...; bscookie=...; lang=...; lidc=...; timezone=...; li_theme=...; li_theme_set=...
READINESS_KEY=a_separate_random_monitoring_key
```

To obtain them from a LinkedIn session you own:

1. Sign in to LinkedIn normally.
2. Open DevTools, then **Application → Storage → Cookies → https://www.linkedin.com**.
3. Copy `li_at` and `JSESSIONID` into their dedicated secret fields.
4. Copy the available `liap`, `bcookie`, `bscookie`, `lang`, `lidc`, `timezone`, `li_theme`, and `li_theme_set` pairs into `LINKEDIN_ADDITIONAL_COOKIES`, separated by semicolons.
5. Preserve the quotes around `JSESSIONID` if DevTools shows them.

These values are equivalent to credentials. Never paste them into source, logs, issues, screenshots, or Git commits. `.env` and `storage-state.json` are gitignored, but environment secrets are the supported runtime configuration.

The session can expire or be invalidated. Replace the LinkedIn session secrets after signing in manually again; the service intentionally does not automate login or checkpoint recovery.

The direct client honors a new `li_at` or `JSESSIONID` if LinkedIn legitimately rotates either through a `Set-Cookie` response while the process remains alive. This can preserve normal server-directed rotation, but it cannot renew an expired login and in-memory rotations do not survive a Render restart.

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
      "extractionMode": ["html"],
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
{
  "status": "ok",
  "linkedInSessionConfigured": true,
  "readinessCheckConfigured": true,
  "sessionEmailAlertConfigured": true
}
```

This is a liveness/configuration check and does not contact LinkedIn.

### `GET /ready`

Actively validates the configured session through LinkedIn's lightweight authenticated `/voyager/api/me` endpoint. It is protected separately so public callers cannot trigger monitoring requests:

```bash
curl --fail \
  --header 'x-readiness-key: <READINESS_KEY>' \
  'https://<service-name>.onrender.com/ready'
```

```json
{
  "status": "ready",
  "linkedIn": {
    "authenticated": true,
    "checkedAt": "2026-08-27T13:20:46.000Z",
    "durationMs": 180,
    "reason": null,
    "cache": "miss"
  }
}
```

Successful and failed checks are cached for five minutes by default. An invalid session returns HTTP `503` with `status: "not_ready"` and a non-sensitive reason such as `authentication_required`; an incorrect monitoring key returns `401`.

When SMTP alerting is configured, either a failed readiness check or a recruiter request that encounters `authentication_required`/`challenge_required` immediately schedules an email. Repeated failures are suppressed for one hour by default. The message contains the reason, detection source, timestamp, service URL, and recovery instructions; it never contains LinkedIn cookies or the requested profile URL.

### Can the cookies be refreshed automatically?

Not after the web session has expired. LinkedIn's supported refresh-token endpoint applies to OAuth access tokens for approved products/partners; it does not refresh `li_at`/`JSESSIONID` web cookies or grant the arbitrary-profile visibility required by this assignment. OpenID Connect similarly returns lite information about the consenting signed-in member, not arbitrary profiles. See LinkedIn's official [OAuth refresh-token documentation](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens) and [OpenID Connect documentation](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2).

Automating the username/password login flow would introduce credential storage, checkpoints/MFA, and challenge-bypass risk, and would conflict with this project's no-browser, no-login-automation boundary. When readiness reports expiry, sign in normally and replace the encrypted LinkedIn session secrets.

## Reverse-engineered extraction approach

1. The input parser accepts only a LinkedIn HTTPS `/in/{id}` URL and produces a fixed canonical origin.
2. The client sends the authenticated cookie set and corresponding CSRF token directly to `/mwlite/profile/in/{publicIdentifier}`. Redirects are not followed, so login, auth-wall, and checkpoint responses can be classified safely.
3. That endpoint returns the top card, About, Experience, Education, Skills, Certifications, Languages, and image references as server-rendered mobile HTML in one response.
4. Cheerio extracts mobile entity lockups, grouped experience roles, accomplishment subsections, delayed image URLs, and the visible top card without executing client-side JavaScript.
5. The normalizer maps recognizable entries to the stable public schema, collapses duplicates, parses date ranges, and emits warnings for fields LinkedIn omitted or whose current shape was not recognized.
6. Results are cached in memory, while a FIFO semaphore serializes direct extraction by default.

No client-side JavaScript is executed. Headers identify the mobile-web surface being requested; there is no runtime fingerprint manipulation, timing jitter, challenge solver, or automated sign-in.

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
| `LINKEDIN_ADDITIONAL_COOKIES` | empty | Semicolon-separated first-party device cookies required by the mobile profile surface |
| `READINESS_KEY` | empty | Secret header value protecting active `/ready` checks |
| `READINESS_CACHE_TTL_SECONDS` | `300` | Cache lifetime for active session-check results |
| `READINESS_TIMEOUT_MS` | `5000` | Timeout for the lightweight session check |
| `SMTP_HOST` | empty | SMTP server used for immediate session alerts |
| `SMTP_PORT` | `587` | SMTP server port |
| `SMTP_SECURE` | `false` | Use implicit TLS, normally `true` with port `465` |
| `SMTP_USER` | empty | SMTP account username |
| `SMTP_PASS` | empty | SMTP password or provider-specific App Password |
| `SESSION_ALERT_EMAIL_FROM` | `SMTP_USER` | Optional sender override |
| `SESSION_ALERT_EMAIL_TO` | empty | Destination for session-expiry alerts |
| `SESSION_ALERT_COOLDOWN_SECONDS` | `3600` | Minimum interval between duplicate alert emails |
| `SERVICE_PUBLIC_URL` | empty | Public deployment URL included in recovery emails |
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

Automated tests use synthetic fixtures and mocked HTTP responses; they do not contact LinkedIn. `npm run check` type-checks, runs the unit/API tests, builds the production output, and exercises the built Fastify service and rate limiter over a real local TCP socket. CI repeats the complete check, production dependency audit, and Docker build.

## HTTPS deployment on Render

The included `render.yaml` defines a Free Docker web service with Render-managed HTTPS, a `/health` check, public URL-only evaluation, a strict request rate, serialized extraction, and manual deploys.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Subramanyarao11/linkedin-profile-api)

1. Click **Deploy to Render** and create the Blueprint.
2. Supply `LINKEDIN_LI_AT`, `LINKEDIN_JSESSIONID`, `LINKEDIN_ADDITIONAL_COOKIES`, and a separately generated `READINESS_KEY` in Render's encrypted secret prompts. Do not add their values to `render.yaml`.
3. To enable immediate email alerts, set `SMTP_USER`, `SMTP_PASS`, `SESSION_ALERT_EMAIL_TO`, and `SERVICE_PUBLIC_URL`. With Gmail, use a Google App Password rather than the account's normal password; the Blueprint already selects `smtp.gmail.com`, port `465`, and TLS.
4. Open `https://<service-name>.onrender.com/`, paste a profile URL, and inspect the structured response.
5. Verify `/health`, `/ready`, `/docs`, and `POST /v1/profiles`.

### Expiry monitoring

`.github/workflows/session-monitor.yml` calls the protected readiness endpoint every six hours and fails when the deployed session is no longer authenticated. To enable it:

1. In GitHub, open **Settings → Secrets and variables → Actions**.
2. Add `DEPLOYMENT_URL`, for example `https://linkedin-profile-api.onrender.com`.
3. Add `READINESS_KEY` with the same value configured in Render.
4. Run **LinkedIn Session Monitor** manually once from the Actions tab and enable GitHub Actions failure notifications for the repository.

Until both repository secrets exist, the scheduled workflow exits successfully with a setup notice and makes no request. The `/ready` cache prevents repeated checks from repeatedly contacting LinkedIn.

The GitHub monitor intentionally remains on a six-hour schedule. Immediate SMTP alerting covers recruiter-triggered authentication failures between scheduled checks. GitHub Actions failure notifications provide a second signal if SMTP delivery is unavailable.

Free services sleep while idle, so the first request after inactivity can be slow. Automatic deploys are disabled so a reviewed, working extraction version is not replaced unexpectedly. Other container hosts work if they provide outbound HTTPS, encrypted secrets, and TLS termination.

## Known limitations

- LinkedIn's mobile HTML format is private and can change without notice. A format change can require parser maintenance.
- Results are limited to what the configured account can see and vary with privacy settings, locale, experiments, and the sections a member has populated.
- Unpopulated, hidden, or unrecognized sections are returned as empty arrays and reported through warnings instead of being guessed.
- Session cookies expire and can trigger login or a checkpoint. The API reports this and requires manual session renewal.
- Server-issued auth-cookie rotations are retained only in memory; Render restarts return to the encrypted values configured in the service.
- Email alerts are best-effort and depend on the configured SMTP provider; one-hour deduplication prevents a broken public session from generating an email storm.
- Each uncached extraction makes one LinkedIn mobile-profile request; readiness monitoring uses a separate lightweight member request.
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
    normalize.ts               Stable response-schema orchestration
    normalization/             Entity, HTML, dates, images, and value helpers
  linkedin-session.ts          Shared cookie state and safe response rotation
  linkedin-readiness.ts        Cached lightweight authentication probe
  session-alert.ts             Deduplicated SMTP authentication alerts
  profile-url.ts               Strict URL canonicalization and SSRF guard
  scrape-service.ts            Bounded concurrency and in-memory cache
  server.ts                    Runtime construction and graceful shutdown
tests/                         Synthetic fixtures and unit/integration tests
Dockerfile                     Multi-stage Node.js production container
render.yaml                    Render Blueprint; secret values stay external
```

## License

MIT. LinkedIn is a trademark of LinkedIn Corporation. This project is independent and is not endorsed by LinkedIn.
