# Plan

**Delegate to AI** (low-cost subagents, each in its own git worktree): scaffolding, endpoints, React pages, seed data, test code, README drafts.

**Keep for myself**: the spec and API contract (`docs/SPEC.md`), data model, the idempotency / tenant-isolation / timezone design, reviewing every diff, running test gates, merging PRs, and the written reflection.

**Build order**: scaffold + test harness → schema, seed, session, contract → certificate list → idempotent bulk issue → detail + revoke → streaming CSV export → self-check → docs.

Every milestone passes its test gate (unit/functional first, then Playwright) and lands as one PR.
