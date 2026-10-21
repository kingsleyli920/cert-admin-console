# AGENTS.md — rules for AI agents working in this repo

Read this file, then the sections of `docs/SPEC.md` your task names. The spec is the
single source of truth for domain rules, the API contract and the test plan. If the spec
and your task prompt disagree, stop and report — do not guess.

## Environment (every shell command)
```sh
source ~/.nvm/nvm.sh && nvm use 24 >/dev/null   # system default Node is v26; this project uses 24
export PLAYWRIGHT_BROWSERS_PATH="/Users/kingsley/projects/favorites/ocean interview/.cache/ms-playwright"
```
- Never install anything globally, never change nvm aliases, shell profiles or brew.
- Never add a dependency that is not in `docs/SPEC.md` §2 without asking. Versions are pinned exactly.
- Each worktree uses its own `PORT`, `WEB_PORT`, `DB_PATH` when running servers or tests.

## Commands
| Purpose | Command |
|---|---|
| Install | `npm ci` |
| Dev (server :3001 + web :5173) | `npm run dev` |
| Typecheck | `npm run typecheck` |
| Fast tests | `npm run test:be:unit`, `test:be:ft`, `test:fe:unit`, `test:fe:ft`, `test:e2e:api`, `test:contract` |
| Playwright | `npm run test:e2e:web`, `test:e2e:ui`, `test:visual` |
| Everything | `npm run test:all` |

Run fast tests first; run Playwright only after they pass.

## Invariants (a violation is a blocking review finding)
1. Every SQL statement on tenant data has `tenant_id = ?`; repo functions take `tenantId` first. Cross-tenant access returns **404**.
2. All SQL is parameterized; sort columns come from a whitelist.
3. Times are stored as UTC ISO strings and displayed only via `formatInTenantTz` from `@cac/shared` (`en-AU`). No `toLocaleString()` without `timeZone`, no hard-coded offsets.
4. Issuing/revoking and its audit row happen in the **same transaction**.
5. The idempotency key is claimed by `INSERT` + `UNIQUE(tenant_id, idempotency_key)` — never SELECT-then-INSERT. Detect unique violations with `err.errcode === 2067`; after any error inside a transaction, `ROLLBACK` explicitly.
6. List and CSV export share `buildCertificateQuery`; export streams via `Readable.from(generator over stmt.iterate())`, no LIMIT.
7. Every data view handles loading, empty and error states.
8. npm scripts must be cross-platform: no `FOO=bar cmd`; env defaults live in code.
9. `@cac/shared` schemas (the API contract) change only by the main agent.

## Boundaries
- **Always**: stay inside your task's files and worktree; write tests for every behavior you add; run the test commands and paste their output in your report.
- **Test-first required** for domain logic: `shared/` (time, csv, schemas), bulk issue, tenant scoping, revoke, serial numbers, CSV export. UI code ships with its tests in the same change.
- **Never**: commit to `main` or integration branches, push, merge, force-push, update visual baselines (`--update-snapshots`), skip or weaken a failing test, or touch files outside your task.

## Commits (on your task branch only)
- Conventional Commits: `feat(server): …`, `test(web): …`, `fix(shared): …`, `chore: …`.
- One logical change per commit, ≲300 changed lines (lockfiles, snapshots, images excluded). Split by layer: schema → repo/service → route → tests → UI.

## Skills to load
| Task | Skills |
|---|---|
| Backend | `fastify-best-practices`, `api-and-interface-design`, `test-driven-development` |
| Frontend | `frontend-ui-engineering`, `test-driven-development` |
| Tests | `playwright-skill`, `test-driven-development` |
| Bug fix | `systematic-debugging` |
| Before reporting done | `verification-before-completion` |

Project overrides to skill guidance are listed in `.claude/SKILLS_PROVENANCE.md` and win over the skill text.

## UI
Ant Design 6 defaults (adjust only primary color and radius), admin-console density, English copy, `en-AU` dates. Status colors always paired with text: valid/issued green, revoked/failed red, skipped grey. Prefer `getByRole`; add `data-testid` only for non-semantic elements (table rows, status tags, progress).
