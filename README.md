# Certificate Admin Console

Internal admin console for a multi-tenant corporate training platform. Tenant admins can:

- **List** course-completion certificates with search, filters, sorting and URL-synced state.
- **Bulk-issue** certificates for a course. Re-running is idempotent, and an interrupted run resumes after a server restart.
- **Inspect and revoke** a certificate, with an audit timeline.
- **Export** the filtered list as a streamed CSV.

Sign-in is simulated with demo accounts. There is no real authentication (see [Assumptions and non-goals](#assumptions-and-non-goals)).

## Quick start

Prerequisites: Node.js 22.13 or later. The project is developed and tested on Node 24 LTS, the version in `.nvmrc`. With nvm:

```sh
nvm use
npm install
npm run dev
```

Open http://127.0.0.1:5173 and sign in as one of the demo admins.

- `npm run dev` starts the API on http://127.0.0.1:3001 and the web app on http://127.0.0.1:5173 (use `127.0.0.1`, not `localhost`: Vite binds IPv4 only). Vite proxies `/api` to the API.
- On first start the server creates `server/data/app.db` (SQLite) and seeds it. No other setup is needed.
- `npm run db:reset` deletes the database and recreates it from the seed data. Stop `npm run dev` first, because the running server holds the database open.
- If the Node version does not match, the `predev` script stops with a message.

## Demo accounts and data

On the `/sign-in` page, pick an admin. There is no password.

| Admin | Name | Tenants | Notes |
|---|---|---|---|
| `alice` | Alice Nguyen | HHT, SRA, NHI | Multi-tenant admin |
| `carol` | Carol Smith | HHT | Second admin of HHT, same data as alice |
| `bob` | Bob Fraser | LCL | Single-tenant admin |

| Code | Tenant | Timezone | What it demonstrates |
|---|---|---|---|
| HHT (id 1) | Harbour Health Training | Australia/Sydney | Primary demo tenant. Has DST (AEDT/AEST). Holds the "Fire Safety 2026" bulk-issue example. |
| SRA (id 2) | Swan River Academy | Australia/Perth | Timezone comparison (AWST, no DST). Has a second "Emma Wilson", who is a different learner record from HHT's. |
| LCL (id 3) | Large Corp Learning | Australia/Sydney | Exactly 8,000 certificates. Pagination and large export. |
| NHI (id 4) | New Horizons Institute | Australia/Brisbane | Courses and enrollments but no certificates. The "no certificates yet" empty state. |

### 5-minute demo

1. Run `npm run dev` and sign in as `alice`. Open HHT's certificate list. Try search, sorting, pagination and both empty states.
2. Open bulk issue, choose **Fire Safety 2026** and confirm. Expect **8 issued, 7 skipped, 1 failed**. The failed learner is inactive.
3. Refresh the run page: progress and results are still shown. Back on the bulk-issue page, Fire Safety 2026 now shows 0 eligible and the issue button is disabled. A retried request with the same `Idempotency-Key` returns the same run, and a new run on the course skips everyone already issued (15 skipped, 1 failed); both are covered by the server acceptance tests.
4. Open a certificate's detail. Check the timezone abbreviation and hover over the time to see UTC. Revoke it with a reason, then check that the audit timeline shows the new REVOKE entry.
5. Switch the tenant to SRA. The learner with the same name is a different record. The certificates issued at `2026-04-04T14:30:00Z` show as 5 Apr 2026 in Sydney and 4 Apr 2026 in Perth.
6. Sign out, then sign in as `bob`. Open an HHT URL, such as `/t/1/certificates`. The result is the 404 page.
7. Export the CSV with filters applied. Open the file and check that the row count matches the list total and that the header names the tenant timezone, e.g. `Issue Date (Australia/Sydney)`.

## Testing

| Layer | Scope | Command |
|---|---|---|
| L1a Backend unit | Pure functions: query builder, whitelists, serial numbers, outcome classification, CSV, timezone | `npm run test:be:unit` |
| L1b Backend functional | Each module through `fastify.inject()`, fresh in-memory DB per case | `npm run test:be:ft` |
| L1c Frontend unit | Hooks and components with React Testing Library | `npm run test:fe:unit` |
| L1d Frontend functional | Page behavior with MSW (states, debounce, double-click, progress, revoke dialog) | `npm run test:fe:ft` |
| L2 Frontend E2E | Real browser, backend mocked with `page.route` | `npm run test:e2e:web` |
| L3 Backend E2E | Real server process and temp DB file, over HTTP only | `npm run test:e2e:api` |
| L4 Contract | The frontend's API client against the real backend. Every response is checked against the shared schemas. | `npm run test:contract` |
| L5 Full stack | Real frontend and backend in Playwright (`fullstack` project) | `npm run test:e2e:ui` |
| L5 Visual | Screenshot comparison with `toHaveScreenshot` (`visual` project) | `npm run test:visual` |

Aggregate scripts:

- `npm run typecheck` runs `tsc --noEmit` for every workspace (TypeScript 5.9).
- `npm run test:fast` runs all Vitest projects.
- `npm run test:be` runs L1a, L1b, L3 and L4. `npm run test:fe` runs L1c, L1d and L2.
- `npm run test:all` runs `typecheck`, then all Vitest projects, then all Playwright projects.

Playwright needs a browser once:

```sh
npx playwright install chromium
```

Playwright starts its own API and web server, using a test database under `test-results/`. Stop `npm run dev` before running it, or it may reuse the dev servers, which do not expose the test-only reset route.

**Visual baselines are generated on macOS** and their file names carry a `-darwin` suffix. On Linux or Windows they will not match. Run everything except the visual project:

```sh
npx playwright test --project=web-mock --project=fullstack
```

Run `npm run typecheck` and `npm run test:fast` first, and run Playwright only after they pass.

## Architecture

### Stack

| Area | Choice |
|---|---|
| Server | Fastify 5, @fastify/cookie 11, zod 4 (validated through a small custom compiler in `server/src/plugins/zod.ts`), tsx 4 |
| Database | `node:sqlite` (built into Node, no native dependencies), WAL mode, one file |
| Web | React 19, Vite 7, Ant Design 6, React Router 7 (library mode), TanStack Query 5 |
| Shared | `@cac/shared` workspace package: zod schemas (the API contract), types, time and CSV helpers. Exported as TypeScript source, no build step. |
| Testing | Vitest 4, React Testing Library 16, MSW 2, Playwright 1.63 |

All versions are pinned exactly and `package-lock.json` is committed.

### Repository layout

```
shared/src/          schemas.ts (API contract), time.ts, csv.ts
server/src/
  app.ts             buildApp(): plugins and routes
  index.ts           startup: open and seed the DB, listen on 127.0.0.1
  config.ts          environment variables and defaults
  db/                schema.sql, open.ts, seed.ts, export-connection.ts
  plugins/           session.ts (cookie and tenant guard), errors.ts, zod.ts
  modules/           bulk-issue/, certificates/, courses/, session/
web/src/             App.tsx, pages/, components/, api/
server/test/         unit/, ft/, e2e/, helpers/
e2e/                 contract/, web-mock/, fullstack/, visual/, fixtures/
docs/                SPEC.md, REFLECTION.md, pr-assets/
```

Each module contains its routes, its repo functions and feature code such as `bulk-issue/runner.ts`.

### Data model

- `tenants` (code, IANA timezone, `next_serial`), `admins`, and `admin_tenants` (many-to-many).
- `courses`, `learners` (`active` or `inactive`), `enrollments` (`enrolled` or `completed`).
- `certificates` (`valid` or `revoked`). At most one per (tenant, course, learner). A revoked certificate still occupies that slot, so re-issuing is not supported.
- `audit_logs`: one `ISSUE` or `REVOKE` row per business write.
- `bulk_issue_runs` (unique on tenant and idempotency key) and `bulk_issue_run_items` (`pending`, `issued`, `skipped` or `failed`).

Serial numbers have the form `{CODE}-{YYYY}-{6-digit sequence}`. The year is the tenant's local year, and the sequence is per tenant.

### Key design decisions

- **Tenant isolation.** The session plugin checks the admin and the tenant on every request. Every repo function takes `tenantId` first and every SQL statement has `tenant_id = ?`. A tenant the admin does not own, or a resource outside the tenant, returns 404 rather than 403, so the existence of other data is not revealed. (`server/src/plugins/session.ts`, `server/src/modules/*/repo.ts`)
- **Idempotent bulk issue.** The run is claimed by an `INSERT` under `UNIQUE(tenant_id, idempotency_key)`, never a select-then-insert. Each learner is settled in its own transaction. The unique certificate slot means at most one certificate per learner, even across concurrent runs. Serial allocation happens in the same transaction. Runs left `running` resume on startup. (`server/src/modules/bulk-issue/repo.ts`, `runner.ts`, `serial.ts`)
- **Timezones.** Timestamps are stored as UTC ISO strings. They are displayed only through `formatInTenantTz` (`en-AU`, with zone abbreviation). Calendar dates and serial years use `tenantLocalDate` and `tenantLocalYear` with the tenant's IANA zone. (`shared/src/time.ts`)
- **Audit trail.** The `ISSUE` and `REVOKE` audit rows are written in the same transaction as the certificate change. (`server/src/modules/bulk-issue/repo.ts`, `server/src/modules/certificates/repo.ts`)
- **CSV export.** The list and the export share `buildCertificateQuery`. The export streams with `Readable.from` over `stmt.iterate()`, so backpressure applies and nothing is buffered. It reads from its own read-only connection pinned to one snapshot. Output is RFC 4180 with a formula-injection guard and a UTF-8 BOM. (`server/src/modules/certificates/query.ts`, `export.ts`, `server/src/db/export-connection.ts`, `shared/src/csv.ts`)

## Configuration

Defaults are in `server/src/config.ts`. Environment variables override them.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | API port, bound to 127.0.0.1. Vite's `/api` proxy points here. |
| `DB_PATH` | `server/data/app.db` | SQLite file. Relative paths resolve from the repo root. |
| `APP_ENV` | `development` | When `test`, the server registers `POST /api/__test__/reset`. Playwright sets this for its own server. |
| `BULK_ISSUE_DELAY_MS` | `150` | Pause after each bulk-issue item, from 0 to 60000 ms. Set to `0` in tests. |
| `WEB_PORT` | `5173` | Vite dev server port. Vite fails instead of picking another port. |

To run a second checkout beside the first, set different ports and database paths (POSIX shell):

```sh
PORT=3101 WEB_PORT=5273 DB_PATH=server/data/second.db npm run dev
```

## Assumptions and non-goals

- **Simulated sign-in.** `POST /api/session` takes an admin id and sets an `httpOnly`, `SameSite=Lax` cookie. Identity is never read from request headers, so a plain browser download of the CSV works.
- **One role.** Every user is a tenant admin. An admin can manage several tenants and picks the active one in the top bar. A tenant the admin does not own shows the 404 page.
- **Not included:** real login or SSO, notifications, certificate PDFs, re-issuing after revocation, adding or editing courses and learners, multi-language support, deployment, and a mobile layout. The layout only needs to stay undistorted at 768 px.
- **Single process.** The bulk-issue runner runs inside the API process and the data lives in one SQLite file. It is not designed for multiple server instances.
- **Deterministic seed.** Seed ids and timestamps are fixed. Tests depend on them, so change them only together with the tests.

## Working with AI

This project was built with AI coding agents under a human-owned plan. `PLAN.md` gives the build order and lists what the author kept for themselves: the spec, the data model, the key design decisions, reviewing every diff, and merging. `AGENTS.md` holds the rules for agents (invariants, commands, boundaries, and which skill to load), and `CLAUDE.md` imports it. Reviewed agent skills live in `.claude/skills/`, and `.claude/SKILLS_PROVENANCE.md` records where each one came from, what was changed, and the project overrides. `PLAN.md` says each milestone lands as one PR. Screenshots and GIFs from those PRs are in `docs/pr-assets/`.

## Submission

| Item | Where |
|---|---|
| Repository and commit history | This repository. Each milestone landed as one pull request (#1–#7) with its own commits. |
| Screen recording | _Link to be added by the author._ |
| Step 1 plan | [`PLAN.md`](PLAN.md) |
| AI instruction files | [`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md), [`.claude/skills/`](.claude/skills/) with [`.claude/SKILLS_PROVENANCE.md`](.claude/SKILLS_PROVENANCE.md) |
| Demo data | Seed script [`server/src/db/seed.ts`](server/src/db/seed.ts), applied automatically on first start; `npm run db:reset` restores it. |
| Written reflection and design answers | [`docs/REFLECTION.md`](docs/REFLECTION.md) |

## Docs
- [`docs/SPEC.md`](docs/SPEC.md) — product rules, architecture, API contract, test plan
- [`PLAN.md`](PLAN.md) — build plan
- [`AGENTS.md`](AGENTS.md) — instructions for AI coding agents
- [`docs/REFLECTION.md`](docs/REFLECTION.md) — written reflection and design-question answers
