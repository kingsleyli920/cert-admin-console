# Certificate Admin Console

Internal admin console for a multi-tenant corporate training platform: tenant admins search,
bulk-issue, inspect, revoke and export course-completion certificates.

> Work in progress — setup, testing and design notes are completed in the final milestone.

## Quick start
Requires Node.js ≥ 22.13 (developed on 24 LTS; see `.nvmrc`).

```sh
npm install
npm run dev
```
Open http://localhost:5173 and sign in as a demo admin.

## Docs
- [`docs/SPEC.md`](docs/SPEC.md) — product rules, architecture, API contract, test plan
- [`PLAN.md`](PLAN.md) — build plan
- [`AGENTS.md`](AGENTS.md) — instructions for AI coding agents
