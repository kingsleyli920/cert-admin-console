# Certificate Admin Console — Technical Spec

## 1. Product

### 1.1 Roles and login (simulated)
- The only role is tenant admin (`admin`). One admin can manage multiple tenants. The current tenant is selected with the tenant switcher in the top bar.
- Simulated login: the `/sign-in` page selects one demo admin, then `POST /api/session` writes an `httpOnly` cookie. **Do not pass identity in request headers.** A direct browser CSV download cannot carry custom headers.
- Any page accessed without login redirects to `/sign-in`. After login, accessing a tenant that does not belong to the admin shows a 404 page.

### 1.2 Domain rules (single source of truth)

| Concept | Rule |
|---|---|
| Enrollment status | `enrolled` or `completed` (`completed` carries `completed_at`) |
| Learner status | `active` or `inactive` |
| One certificate | At most one certificate per (tenant, course, learner) combination, enforced by a DB unique constraint. A revoked certificate still occupies this slot. **Re-issuing is not supported.** |
| Serial number | `{TENANT_CODE}-{YYYY}-{6-digit sequence}`. `YYYY` is the year in the tenant's local time. The sequence increments per tenant (`tenants.next_serial`) and is generated in the same transaction as the certificate insert. Globally unique. |
| Certificate status | `valid` or `revoked`. Reason is required on revoke. Revoking an already revoked certificate returns 409. |
| Time | The DB always stores UTC ISO strings. Display always goes through `formatInTenantTz(utc, tz)` (`en-AU`, with timezone abbreviation, e.g. AEDT / AWST). |
| Audit | Each issue writes one `ISSUE` entry. Each revoke writes one `REVOKE` entry. Fields: actor, time, course, learner, certificate, run. Written in the **same transaction** as the business write. |

### 1.3 Bulk issue

**Outcome rules.** Each enrolled learner of the course is evaluated individually.

| Condition (checked in order) | Outcome | reason |
|---|---|---|
| Already has a certificate (valid) | skipped | `already_issued` |
| Already has a certificate (revoked) | skipped | `revoked` |
| Enrollment not completed | skipped | `not_completed` |
| Learner inactive | failed | `learner_inactive` |
| Otherwise | issued | — |
| Unexpected error thrown while issuing | failed | `internal_error` |

**Flow**: select course → view learner distribution (eligible / already issued / not completed / inactive) → confirm dialog → progress bar → result page (three counts + detail table, filterable by outcome).

**Run page** `/t/:tid/bulk-issue/runs/:runId`: refreshing or reopening the page lets the user continue viewing progress. While a run is running, the issue button stays disabled.

**Idempotency**:
- When the user clicks "confirm", generate an `Idempotency-Key`. Pass it as a parameter of the mutation. Only **network errors trigger automatic retry** (max 2 retries). Retries reuse the same key.
- The backend claims the key atomically with `INSERT bulk_issue_runs` + `UNIQUE(tenant_id, idempotency_key)`. On conflict, read the existing run: same course → return it (202); different course → 422. **Do not SELECT then INSERT.**
- In the same transaction that creates the run, insert every enrolled learner of the course as a `pending` run item. The runner then processes `pending` items one by one, each item in its own transaction. Even with a changed key or concurrent execution, the unique constraint guarantees at most one certificate per learner.
- After each item is processed, sleep `BULK_ISSUE_DELAY_MS` (default 150ms, 0 in tests) so progress is visible during a demo.

### 1.4 List, detail, export

**List**
- One search box. Matches learner name (case-insensitive substring) or serial number (prefix).
- Filters: course and status.
- Column header sorting on `issuedAt`, `learnerName`, `courseTitle`, `serial`. Secondary sort key is `id`.
- Page size 20, maximum 100.
- All filters are synced to the URL.

**Empty states** (two kinds):
- Tenant has no certificates yet: button navigates to bulk issue.
- Tenant has certificates but the filters match none: button clears the filters.

**Detail**
- Shows: serial number, course, learner, issue time (tenant timezone + abbreviation; hover shows UTC), status tag, revoke info, and the certificate's audit timeline.
- Revoke opens a confirmation dialog and requires a reason.

**CSV**
- Columns fixed: `Learner Name, Course Title, Serial Number, Issue Date`.
- `Issue Date` is the tenant-local calendar date, `YYYY-MM-DD`. Its header names the tenant's IANA timezone, e.g. `Issue Date (Australia/Sydney)` for HHT, `Issue Date (Australia/Perth)` for SRA.
- Filters are the same as the list. Not paginated.
- Streamed output. UTF-8 BOM. RFC 4180 escaping. Cells starting with `= + - @` are prefixed with `'`.
- File name: `certificates-{CODE}-{local date}.csv`.

### 1.5 Non-goals
Real login / SSO, notifications, certificate PDF, re-issuing after revocation, add/edit/delete of courses and learners, multi-language, deployment, and mobile layout. Mobile only needs to be undistorted at 768px width.

---

## 2. Architecture

### 2.1 Stack and version policy

**Version selection rule**: for each major version, choose the one AI tools know best and that is still maintained. Do not chase the latest major. TS 7, Vite 8, React Router 8, MSW 3, and Vitest 5 are too new, and AI-generated code tends to get them wrong. `package.json` pins exact versions and the lockfile is committed. Only use versions released more than 2 weeks ago.

**Node**: development uses **Node 24 LTS** (isolated via nvm; do not change the system default, which is v26). Set `engines: >=22.13` and provide `.nvmrc`. The `predev` script checks the Node version and prints a clear message when it does not match.

| Layer | Choice (major version) |
|---|---|
| Backend | Fastify 5 + @fastify/cookie 11 + zod 4 + tsx 4. Zod schemas are plugged into Fastify through a small custom validator/serializer compiler (`server/src/plugins/zod.ts`; no third-party type provider): route `schema.body/querystring/params` are validated with the shared schemas, and responses are checked against their schema (mismatch → 500). |
| DB | `node:sqlite` (built in, zero native dependencies). WAL mode. File `server/data/app.db` (gitignored). |
| Frontend | React 19 + Vite 7 + antd 6 + React Router 7 (library mode) + TanStack Query 5 |
| Shared | Workspace package `@cac/shared`: zod schemas, types, `formatInTenantTz`, CSV utilities. Exports TS source directly; no build step. |
| Testing | Vitest 4 (`test.projects`), RTL 16, MSW 2, Playwright **1.63** (1.64 was released less than 2 weeks ago; do not use APIs that the skill docs mark as 1.64-only) |
| Quality | `tsc --noEmit` (TS 5.9). No ESLint. |
| Startup | Root `npm run dev`: concurrently starts the server (:3001, `tsx watch`) and the web app (:5173, `/api` proxied to the server). On first start, migrate and seed run automatically. |

**Locked versions.** Lock with `.npmrc`: `before=2026-10-06`, `save-exact=true`, `engine-strict=true`.

| Package | Version | Package | Version |
|---|---|---|---|
| typescript | 5.9.3 | react / react-dom | 19.3.0 |
| vite (**also install at root**) | 7.3.6 | antd | 6.6.5 |
| vitest | 4.1.11 | @ant-design/icons | 6.3.4 |
| @playwright/test | 1.63.0 | react-router | 7.18.4 |
| concurrently | 9.2.4 | @tanstack/react-query | 5.104.1 |
| fastify | 5.12.5 | @vitejs/plugin-react | 5.2.0 |
| @fastify/cookie | 11.1.2 | jsdom | 30.1.2 |
| zod | 4.6.5 | msw | 2.15.0 |
| tsx | 4.23.15 | @testing-library/react / user-event / jest-dom | 16.3.3 / 14.6.7 / 6.9.1 |
| @types/node | 24.19.1 | @types/react / react-dom | 19.3.0 |

### 2.2 Repository layout

```
cert-admin-console/
├── CLAUDE.md                 # single line: @AGENTS.md (so Claude Code loads it automatically)
├── AGENTS.md                 # AI rules: invariants, commands, boundaries, which skill to use
├── PLAN.md                   # Step 1 plan, at most 100 words, written by the author
├── README.md
├── docs/SPEC.md              # English spec: §1 domain rules + §2.4 API contract + §3 test layers (condensed translation)
├── docs/pr-assets/mN/        # PR screenshots / GIFs
├── .claude/skills/           # reviewed skills + SKILLS_PROVENANCE.md
├── shared/src/               # schemas.ts, time.ts, csv.ts, index.ts (+ *.test.ts)
├── server/src/
│   ├── app.ts                # buildApp({ db, now, delayMs }) factory
│   ├── index.ts              # startup, listen on port
│   ├── db/                   # schema.sql, open.ts, seed.ts
│   ├── plugins/              # session (cookie → admin → tenant check), errors
│   └── modules/{certificates,bulk-issue,courses,audit,session}/  # routes / service / repo
├── server/test/{unit,ft,e2e,helpers}/
├── web/src/{api,components,pages,test}/
└── e2e/{fixtures,web-mock,contract,fullstack,visual}/ + playwright.config.ts
```

### 2.3 Data model

```
tenants(id, code UNIQUE, name, timezone, next_serial)
admins(id, name)                     admin_tenants(admin_id, tenant_id)  PK(admin_id, tenant_id)
courses(id, tenant_id, title)
learners(id, tenant_id, name, email, status)
enrollments(id, tenant_id, course_id, learner_id, status, completed_at)  UNIQUE(course_id, learner_id)
certificates(id, tenant_id, course_id, learner_id, serial UNIQUE, issued_at, issued_by,
             status, revoked_at, revoked_by, revoke_reason)       UNIQUE(tenant_id, course_id, learner_id)
audit_logs(id, tenant_id, actor_id, action, certificate_id, course_id, learner_id, run_id, created_at)
bulk_issue_runs(id, tenant_id, course_id, idempotency_key, created_by, created_at, status[running|completed])
                                                                    UNIQUE(tenant_id, idempotency_key)
bulk_issue_run_items(run_id, learner_id, outcome[pending|issued|skipped|failed], reason, certificate_id)
                                                                    PK(run_id, learner_id)
Indexes: certificates(tenant_id, issued_at), certificates(tenant_id, serial), learners(tenant_id, name)
```

- Every repo function takes `tenantId` as its first parameter. Every SQL statement includes `WHERE tenant_id = ?`.
- After a server restart, runs with status `running` automatically resume their remaining `pending` items. (P2. If not done, state this in the README.)

### 2.4 API contract

Frozen once the schema/session milestone lands. Schemas live in `@cac/shared`.

Rules:
- All routes use the prefix `/api`.
- Unauthenticated request → 401.
- Tenant not owned by the current admin, or resource not in that tenant → 404.
- Error body is always `{ error: { code, message } }`.
- Validation failure → 400.
- The exact request/response shapes are the zod schemas in `shared/src/schemas.ts`; this table is a summary.
- Error codes (`errorCodeSchema`): `VALIDATION_ERROR` 400, `BAD_REQUEST` 400 (malformed body), `UNAUTHORIZED` 401, `NOT_FOUND` 404, `ALREADY_REVOKED` 409, `IDEMPOTENCY_KEY_REUSED` 422, `INTERNAL_ERROR` 500.

| Method | Path | Description |
|---|---|---|
| GET | `/admins` | List of demo admins (for the sign-in page) |
| POST / DELETE | `/session` | Sign in with `{adminId}` / sign out |
| GET | `/me` | Current admin + accessible tenants (including timezone) |
| GET | `/tenants/:tid/certificates` | Query: `q, courseId, status, sort, order, page, pageSize` → `{items,total,page,pageSize}` |
| GET | `/tenants/:tid/certificates/export.csv` | Same parameters as above. Not paginated. |
| GET | `/tenants/:tid/certificates/:id` | Detail + audit timeline |
| POST | `/tenants/:tid/certificates/:id/revoke` | Body `{reason}` → 200 / 409 |
| GET | `/tenants/:tid/courses` | `{items:[{id,title,enrolled,counts:{eligible,alreadyIssued,notCompleted,inactive}}]}` — counts follow §1.3 order (`alreadyIssued` = valid or revoked certificate exists; `inactive` = completed, no certificate, learner inactive) |
| POST | `/tenants/:tid/courses/:cid/bulk-issue` | Request header `Idempotency-Key` (required, UUID) → 202 `{run}`. Same key with a different course → 422. |
| GET | `/tenants/:tid/bulk-issue-runs/:runId` | `{run}` — same shape as the POST response: `{id,courseId,courseTitle,status,createdAt,createdBy,total,processed,counts:{issued,skipped,failed,pending},items[]}` |
| GET | `/tenants/:tid/audit-logs` | Paginated (P2) |
| POST | `/__test__/reset` | Registered only when `APP_ENV=test`. Resets the DB to seed state. |

### 2.5 Frontend architecture

- **State layering**:
  - **URL** holds filters, pagination, sorting, and `runId`.
  - **TanStack Query** holds server data. Every `queryKey` includes `tenantId`.
  - **Component state** holds dialogs, forms, and the current idempotency key.
  - Do not use a global store.
- `api/client.ts`: factory `createApiClient({ baseUrl, fetch, headers })`. The browser uses the defaults. Contract tests pass `baseUrl` and the cookie in Node. Responses are parsed with shared schemas.
- Shared components:
  - `QueryState`: three states (loading / error with retry / empty).
  - `TzDate`
  - `NotFound`
  - `AppLayout`: side navigation + top bar (tenant switcher, admin, timezone label, sign out).
- Element locating: prefer semantic queries (role / label). Add `data-testid` to non-semantic elements such as table rows, status tags, and progress bars.
- UI: antd default theme. Only adjust the primary color and border radius. Design for the information density of a back-office system.
  - Status colors are fixed: valid / issued = green, revoked / failed = red, skipped = grey.
  - Every status has a text label. Do not rely on color alone.

### 2.6 Hard implementation constraints (checked in every review)

1. Issue, revoke, and their audit writes happen in the same transaction. Claiming an idempotency key must use a unique constraint. Never SELECT then INSERT.
2. Detect unique-constraint conflicts **only by `err.errcode === 2067`**. `err.code` is `ERR_SQLITE_ERROR` for every SQLite error, so it cannot distinguish them. After an error inside a transaction, an explicit `ROLLBACK` is required. (After the error, `db.isTransaction` is still `true`.)
3. The list and the export share `buildCertificateQuery(tenantId, filters)`. The export has no `LIMIT`.
4. The export streams with `Readable.from(generator wrapping stmt.iterate())`, relying on backpressure. Do not read all rows into memory.
5. Time display uses only `formatInTenantTz`. Do not use `toLocaleString` without a `timeZone`. Do not hardcode UTC offsets.
6. Sort fields come from a whitelist. All SQL is parameterized. The cookie is set to `httpOnly; SameSite=Lax`.
7. npm scripts must not use POSIX-only inline env syntax such as `FOO=bar cmd`. Put environment variable defaults in code.

---

## 3. Testing

### 3.1 Test layers

| Layer | Tool | Scope | Script |
|---|---|---|---|
| L1a Backend UT | Vitest | Pure functions: query builder, whitelists, serial numbers, outcome classification, CSV, timezone | `test:be:unit` |
| L1b Backend FT | Vitest + `inject` | Full behavior per module. Each case uses a fresh in-memory DB. | `test:be:ft` |
| L1c Frontend UT | Vitest + RTL | Hooks and components: `QueryState`, `TzDate`, `useIdempotencyKey`, URL sync | `test:fe:unit` |
| L1d Frontend FT | Vitest + RTL + MSW | Page behavior: three states, debounce, double-click submits once, progress, revoke dialog | `test:fe:ft` |
| L2 Frontend E2E | Playwright `web-mock` | Real browser + `page.route` mocked backend. Tests that the key is unchanged when retrying after a network failure. | `test:e2e:web` |
| L3 Backend E2E | Vitest + real process | Temp DB file + random port. Runs full business flows only over HTTP. Large-tenant export. | `test:e2e:api` |
| L4 Contract | Vitest | Uses the frontend's real api client against the real backend. Every response (including error responses) is validated against shared schemas. | `test:contract` |
| L5 Full stack + visual | Playwright `fullstack` / `visual` | Real frontend and backend. `workers: 1`. Calls `/__test__/reset` before each case. Video, screenshots, trace. `toHaveScreenshot`. | `test:e2e:ui` / `test:visual` |

- Aggregate scripts: `test:be` = L1a + L1b + L3 + L4. `test:fe` = L1c + L1d + L2. `test:all` = all layers. Plus `typecheck`.
- Visual regression determinism: fixed seed. `page.clock` fixes the current time. Animations are disabled. Viewport 1280×800. Content generated at runtime (new certificate time, runId) is covered with masks. Baselines are generated on macOS (file names carry a platform suffix). The README must say so. **Baselines may only be updated by the main agent after review.**
- Parallel isolation: each worktree sets its own `PORT / WEB_PORT / DB_PATH`. Playwright browsers are installed in `ocean interview/.cache/ms-playwright`. Export `PLAYWRIGHT_BROWSERS_PATH` before each run.

### 3.2 Gates (must pass before commit)

**Execution order**: run the fast tests first (typecheck → L1 → L3/L4). Run Playwright (L2 → L5) only after all of them pass. If fast tests fail, do not run Playwright.

- Full-stack node → `test:all` + typecheck
- Backend-only change → `test:be` + typecheck
- Frontend-only change → `test:fe` + affected L5 specs + typecheck
- Scaffold milestone: one smoke case per layer. Self-check milestone: full regression. Docs milestone: in a fresh clone, run every command from the README.

### 3.3 Feature × required test cases

Every case listed must have a matching test.

| Feature | Required test cases |
|---|---|
| Session / isolation | No cookie → 401. alice accessing every route under LCL (list, detail, revoke, export, issue, run) → 404 **(T4)**. After switching tenant, no stale tenant data flashes. bob opening alice's tenant URL sees the 404 page. |
| List | Search by name. Search by serial. Sort on each column. Pagination total is correct. Invalid parameter → 400. Three states. Both empty-state buttons. Filters are written to the URL and kept after refresh. |
| Bulk issue | Same key called twice: same run; certificate count and audit count unchanged **(T1)**. New key re-run: all skipped **(T2)**. Two different keys run concurrently: each learner has at most one certificate **(T3)**. Same key with a different course → 422. Missing key → 400. One case for each outcome branch in §1.3. Each issued item has one audit entry. Double-click sends only one POST. Key is unchanged when retrying after a network failure. After refreshing the run page, progress can still be followed. |
| Detail / revoke | All fields complete. Empty reason → 400. Repeated revoke → 409 **(T7)**. Revoke writes an audit entry. The same UTC instant shows different dates in Sydney and Perth. Sydney abbreviations are correct under both DST and non-DST **(T5)**. |
| Export | Row count equals list total (with filters) **(T6)**. Dates use the tenant timezone. Escaping and formula-injection protection. Full LCL export is streamed (chunked) and completes in under 3 seconds. Download the file on the page and verify the row count. |

### 3.4 Tenant × admin × timezone matrix

Tests must cover every combination below, not a single tenant or admin. Server tests use one shared table-driven helper, `ACCESS_MATRIX` (in `server/test/helpers/`), and every new tenant-scoped route is added to it.

| Admin | Manages | Expected for every tenant-scoped route |
|---|---|---|
| `alice` (multi-tenant) | HHT (Sydney, DST), SRA (Perth), NHI (Brisbane) | HHT/SRA/NHI → allowed; LCL → 404 |
| `carol` (second admin of HHT) | HHT only | HHT → allowed; SRA/LCL/NHI → 404 |
| `bob` (single-tenant) | LCL (Sydney) | LCL → allowed; HHT/SRA/NHI → 404 |
| no session | — | 401 |

| Concern | Cases (milestone where the route lands) |
|---|---|
| Isolation | Every tenant-scoped route × every row of the admin table above, including non-existent and malformed tenant ids (404) and resources of another tenant addressed through an allowed tenant id (404). |
| Same tenant, several admins | alice and carol see identical HHT data; audit records the acting admin (who issued / who revoked) (M4, M5); alice and carol bulk-issuing the same course concurrently → at most one certificate per learner (M4); carol revokes a certificate alice issued → detail shows both actors (M5). |
| Multi-tenant admin | alice's tenant switcher lists exactly HHT/SRA/NHI; switching shows that tenant's timezone label and data with no stale rows from the previous tenant. |
| Single-tenant admin | bob's switcher lists only LCL; opening any other tenant URL shows the 404 page. |
| Timezones | The same UTC instant renders on different local dates in Sydney vs Perth; Sydney before/after the DST change shows AEDT/AEST; Brisbane always AEST; CSV `Issue Date` and its header use each tenant's own timezone (M6); serial `YYYY` uses the tenant-local year at the New Year boundary (M4). |
| Learners | Same-name learners in different tenants never cross (Emma Wilson in HHT vs SRA); every learner state (completed / enrolled / inactive / valid cert / revoked cert) maps to its §1.3 outcome (M3 counts, M4 runs); a tenant with learners but zero certificates (NHI) shows the "no certificates yet" empty state (M3). |

---

## 4. Seed data

Deterministic seed. All ids and timestamps are fixed.

| Tenant | code | timezone | Purpose |
|---|---|---|---|
| Harbour Health Training | HHT | Australia/Sydney | Primary demo tenant (has DST) |
| Swan River Academy | SRA | Australia/Perth | Timezone comparison (no DST) |
| Large Corp Learning | LCL | Australia/Sydney | Exactly 8,000 certificates. Demonstrates pagination and export at scale. |
| New Horizons Institute | NHI | Australia/Brisbane | Courses and enrollments but zero certificates. Demonstrates the "no certificates yet" empty state. |

- Admins: `alice` "Alice Nguyen" (HHT + SRA + NHI), `bob` "Bob Fraser" (LCL), `carol` "Carol Smith" (HHT only — a second admin of the same tenant). Tenant ids: HHT 1, SRA 2, LCL 3, NHI 4.
- HHT and SRA each have an "Emma Wilson". These are two different learner records.
- HHT has one certificate issued at `2026-04-04T14:30:00Z` (Sydney 2026-04-05 01:30 AEDT). SRA has one certificate at the same instant (Perth 2026-04-04 22:30 AWST).
- HHT's "Fire Safety 2026" course has 16 learners:
  - 8 completed, no certificate, active (→ issued)
  - 2 have a valid certificate
  - 1 has a revoked certificate
  - 4 have not completed
  - 1 completed but inactive (→ failed)
- Each tenant has a small number of revoked certificates. All ids and timestamps are fixed. Tests can reference them directly.

---

## 5. Demo script

Shared by the self-check and the L5 user journey.

1. `npm run dev` → sign in as alice → HHT certificate list: search, sort, pagination, both empty states.
2. Bulk issue → Fire Safety 2026 → confirm → progress bar → expect 8 issued / 7 skipped / 1 failed.
3. Issue again with a new key → all skipped. Refresh the run page: progress and results are still shown.
4. Open a certificate detail → timezone abbreviation → revoke → the audit timeline shows the new entry.
5. Switch to SRA → the same-name learner is a different record. The same UTC instant shows a different date.
6. Sign in as bob. Open alice's tenant URL → 404 page.
7. Export CSV with filters applied. Open the file and verify.
8. `npm run test:all` → show the Playwright report (video and screenshots).
