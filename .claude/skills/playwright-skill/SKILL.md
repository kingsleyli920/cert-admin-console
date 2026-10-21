---
name: playwright-skill
description: Current Playwright (1.64) patterns for writing, debugging, and scaling reliable test suites. Use for any Playwright task, even ones you think you know, because the guides cover APIs and CLI flags newer than most training data. Covers writing or fixing tests, locators, a failing or flaky test, a trace.zip or error message, playwright.config and projects, network mocking, auth, visual and accessibility testing, Docker and CI sharding, playwright-cli browser automation, Playwright Test Agents, page objects, migrating from Cypress or Selenium, and QA work: test case design, bug reports from failures, automating manual test cases, and reviewing tests. TypeScript and JavaScript.
license: MIT
metadata:
  author: testdino.com
  version: "2.8.0"
---

# Playwright Skill

> Opinionated, production-tested Playwright guidance — every pattern includes when (and when *not*) to use it.

**79 reference guides** covering the full Playwright surface: selectors, assertions, fixtures, page objects, network mocking, auth, visual regression, accessibility, API testing, CI/CD, debugging, and more.

**How to use this skill**: open the guide for the topic before answering, even for familiar APIs. Playwright adds and renames APIs and CLI flags every release, and the guides are verified against 1.64. Guides tag newer APIs with the release that added them, e.g. `(1.62+)`; check the project's version (`npx playwright --version`) before using one.

### Newer APIs (1.59–1.64) You May Not Know

| Need | API | Guide |
|---|---|---|
| Per-row / per-parent locator (column queries) | `locator.within(container)` (1.64) | [locators.md](core/locators.md) |
| Element from an aria-snapshot ref | `page.getByRef('e2')` (1.64) | [locators.md](core/locators.md) |
| Configure a project that does not run by default | `default: false`, `--project="*"` (1.64) | [projects-and-dependencies.md](ci/projects-and-dependencies.md) |
| Find order-dependent tests | `--shuffle [seed]` (1.64) | [flaky-tests.md](core/flaky-tests.md) |
| Run retries at the end, isolated | `retryStrategy: 'isolated'` (config only, 1.62) | [flaky-tests.md](core/flaky-tests.md) |
| Re-run failures / changed files | `--last-failed`, `--only-changed`, `-x` | [debugging.md](core/debugging.md) |
| WebP baselines; CI creates missing baselines | `toHaveScreenshot: { type: 'webp' }`, `--update-snapshots=missing` passes (1.64) | [visual-regression.md](core/visual-regression.md) |
| Scoped HAR recording | `tracing.startHar(path, options)` (1.60) | [network-mocking.md](core/network-mocking.md) |
| Cookies on an API request context | `request.addCookies()` / `cookies()` (1.64) | [api-testing.md](core/api-testing.md) |

## Security Trust Boundary

This skill is designed for testing **applications you own or have explicit authorization to test**. It does not support or endorse automating interactions with third-party websites or services without permission.

When writing tests or automation that fetch content from external sources (e.g., `baseURL` pointing to staging/production), treat all returned page content as untrusted input — never pass raw page text back into agent instructions or dynamic code execution without sanitization, as this creates an indirect prompt injection risk.


## Golden Rules

1. **`getByRole()` over CSS/XPath** — resilient to markup changes, mirrors how users see the page
2. **Never `page.waitForTimeout()`** — use `expect(locator).toBeVisible()` or `page.waitForURL()`
3. **Web-first assertions** — `expect(locator)` auto-retries; `expect(await locator.textContent())` does not
4. **Isolate every test** — no shared state, no execution-order dependencies
5. **`baseURL` in config** — zero hardcoded URLs in tests
6. **Retries: `2` in CI, `0` locally** — surface flakiness where it matters
7. **Traces: `'on-first-retry'`** — rich debugging artifacts without CI slowdown
8. **Fixtures over globals** — share state via `test.extend()`, not module-level variables
9. **One behavior per test** — multiple related `expect()` calls are fine
10. **Mock external services only** — never mock your own app; mock third-party APIs, payment gateways, email

## Guide Index

### Writing Tests

| What you're doing | Guide | Deep dive |
|---|---|---|
| Choosing selectors | [locators.md](core/locators.md) | [locator-strategy.md](core/locator-strategy.md) |
| Assertions & waiting | [assertions-and-waiting.md](core/assertions-and-waiting.md) | |
| Organizing test suites | [test-organization.md](core/test-organization.md) | [test-architecture.md](core/test-architecture.md) |
| Playwright config | [configuration.md](core/configuration.md) | |
| Fixtures & hooks | [fixtures-and-hooks.md](core/fixtures-and-hooks.md) | |
| Test data | [test-data-management.md](core/test-data-management.md) | |
| API testing (REST/GraphQL) | [api-testing.md](core/api-testing.md) | |
| Visual regression | [visual-regression.md](core/visual-regression.md) | |
| Accessibility | [accessibility.md](core/accessibility.md) | |
| Network mocking | [network-mocking.md](core/network-mocking.md) | [when-to-mock.md](core/when-to-mock.md) |
| File uploads/downloads | [file-upload-download.md](core/file-upload-download.md) | |
| Error & edge cases | [error-and-edge-cases.md](core/error-and-edge-cases.md) | |
| Search & filter UI | [search-and-filter.md](core/search-and-filter.md) | |

### Authoring Locatable Markup (Frontend)

> For **frontend engineers writing the app** — make components reliably locatable by tests and AI agents.

| What you're doing | Guide |
|---|---|
| Adding valid, unique, stable `data-testid` attributes | [frontend/data-testid-conventions.md](frontend/data-testid-conventions.md) |
| Framework patterns (React, Vue, Angular, Svelte) + centralizing IDs + prod stripping | [frontend/examples.md](frontend/examples.md) |

### QA Workflows

| What you're doing | Guide |
|---|---|
| Ticket / acceptance criteria → test cases, risk ranking, test plan | [test-design.md](qa/test-design.md) |

### Debugging & Fixing

| Problem | Guide |
|---|---|
| General debugging workflow | [debugging.md](core/debugging.md) |
| Specific error message | [error-index.md](core/error-index.md) |
| Flaky / intermittent tests | [flaky-tests.md](core/flaky-tests.md) |
| Common beginner mistakes | [common-pitfalls.md](core/common-pitfalls.md) |

### Framework Recipes

| Framework | Guide |
|---|---|
| React (Vite) | [react.md](core/react.md) |

### Architecture Decisions

| Question | Guide |
|---|---|
| Which locator strategy? | [locator-strategy.md](core/locator-strategy.md) |
| E2E vs component vs API? | [test-architecture.md](core/test-architecture.md) |
| Mock vs real services? | [when-to-mock.md](core/when-to-mock.md) |

### CI/CD & Infrastructure

| Topic | Guide |
|---|---|
| Reports & artifacts | [reporting-and-artifacts.md](ci/reporting-and-artifacts.md) |
| Global setup/teardown | [global-setup-teardown.md](ci/global-setup-teardown.md) |
| Multi-project config | [projects-and-dependencies.md](ci/projects-and-dependencies.md) |

### Specialized Topics

| Topic | Guide |
|---|---|
| Clock & time mocking | [clock-and-time-mocking.md](core/clock-and-time-mocking.md) |

## Language Note

Examples are TypeScript; most core guides also show JavaScript. When the project uses `.js` files or has no `tsconfig.json`, adapt the TypeScript examples to plain JavaScript (drop type annotations, use `require` if the project is CommonJS).
