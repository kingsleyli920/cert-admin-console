# Vendored Skills — Provenance & Review

Third-party skills copied into `.claude/skills/` after manual review (2026-10-20).
All sources are MIT-licensed. Nothing was installed from a package manager and no
scripts from these repos were executed.

| Skill (local name) | Source | Commit | Files kept | Local modifications |
|---|---|---|---|---|
| `test-driven-development` | obra/superpowers `skills/test-driven-development` | `b739a8a` | SKILL.md, writing-good-tests.md | none |
| `verification-before-completion` | obra/superpowers | `b739a8a` | SKILL.md | none |
| `using-git-worktrees` | obra/superpowers | `b739a8a` | SKILL.md | none |
| `receiving-code-review` | obra/superpowers | `b739a8a` | SKILL.md | none |
| `systematic-debugging` | obra/superpowers | `b739a8a` | SKILL.md + 3 technique docs + example.ts | dropped `find-polluter.sh`, pressure-test docs, creation log |
| `api-and-interface-design` | addyosmani/agent-skills | `aeac41d` | SKILL.md | none |
| `frontend-ui-engineering` | addyosmani/agent-skills | `aeac41d` | SKILL.md, references/accessibility-checklist.md | reference path rewritten to local `references/` |
| `code-review-and-quality` | addyosmani/agent-skills | `aeac41d` | SKILL.md, references/{security,performance}-checklist.md | reference paths rewritten to local `references/` |
| `fastify-best-practices` | mcollina/skills `skills/fastify` | `c75d70d` | SKILL.md + 15 rule files | dropped websockets, http-proxy, content-type, deployment rules and their index lines |
| `playwright-skill` | testdino-hq/playwright-skill | `178d1cb` | SKILL.md + 28 guides (core/frontend/qa/ci subset) | index trimmed to installed guides; dropped vendor-API guide (`dynamic-test-selection.md`), CLI, migration, POM, unrelated frameworks |
| `user-stories` | phuryn/pm-skills `pm-execution/skills/user-stories` | `07b34f6` | SKILL.md | none |

## Review method

- Small skills (superpowers, addyosmani, user-stories): read in full.
- Large doc sets (fastify rules ~6k lines, Playwright guides ~25k lines): scanned for
  agent-directed instructions, external URLs, shell/network commands, settings/hooks
  edits; spot-read the guides this project depends on most (fastify `testing.md`,
  Playwright `visual-regression.md`). Hits were all code examples.

Rejected: `subagent-driven-development` / `requesting-code-review` (forbid the main agent
from reviewing diffs itself), `using-superpowers` / `brainstorming` (hijack every turn),
`spec-driven-development` (forces stop-and-ask gates that fight the timebox; the plan is
already approved), `ui-ux-pro-max` (Python scripts, conflicts with Ant Design tokens),
`web-design-guidelines` (fetches unpinned remote instructions at runtime),
`webapp-testing` (Python Playwright; duplicates `playwright-skill`).

## Project overrides (project rules win over skill text)

1. **TDD scope** — strict test-first is required for domain logic: `shared/` (time, csv,
   schemas), and server services for idempotent bulk issue, tenant scoping, revoke,
   serial numbers, CSV export. UI scaffolding and layout may ship tests in the same
   change instead of strictly first. (Confirmed by the human on 2026-10-20, per the skill's own exception clause.)
2. **Mocking your own app** — `playwright-skill` rule 10 says never mock your own app.
   This project deliberately has a `web-mock` Playwright layer (frontend E2E with the
   backend mocked via `page.route`). The `fullstack` and `visual` layers never mock.
3. **Test runner** — `fastify-best-practices` examples use `node:test`; this project uses
   **Vitest** with `fastify.inject()`.
4. **Status codes** — `api-and-interface-design` suggests 422 for validation errors; this
   project's contract is 400 for schema validation, 409 for revoking an already-revoked
   certificate, 422 for an Idempotency-Key reused with a different course.
5. **Worktrees** — preference is pre-declared, no consent prompt needed. The main agent
   creates every worktree explicitly with `git worktree add ../worktrees/<branch> -b <branch> <base>`
   (outside the repo, explicit base branch) and hands the path to the subagent. Subagents
   do not create worktrees themselves.
6. **Review** — the main agent reviews every subagent diff itself before merging;
   subagents never merge to integration branches or `main`.
7. **UI** — Ant Design 5 tokens and components, not Tailwind classes from skill examples.
   Desktop admin layout first; must not break at 768px.
8. **Locators** — prefer `getByRole`; use `data-testid` for non-semantic elements
   (table rows, status tags, progress).
9. **Playwright version** — the project pins `@playwright/test` 1.63.0. Do not use APIs the
   `playwright-skill` guides tag as `(1.64)` (e.g. `locator.within`, `page.getByRef`).
