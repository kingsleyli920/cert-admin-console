-- Certificate Admin Console schema (SQLite via node:sqlite).
-- All timestamps are UTC ISO-8601 strings, e.g. 2026-04-04T14:30:00.000Z.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  timezone    TEXT NOT NULL,              -- IANA name, never a fixed offset
  next_serial INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS admins (
  id   TEXT PRIMARY KEY,                  -- e.g. 'alice'
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_tenants (
  admin_id  TEXT    NOT NULL REFERENCES admins(id),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  PRIMARY KEY (admin_id, tenant_id)
);

CREATE TABLE IF NOT EXISTS courses (
  id        INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  title     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_courses_tenant ON courses(tenant_id);

CREATE TABLE IF NOT EXISTS learners (
  id        INTEGER PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  name      TEXT    NOT NULL,
  email     TEXT    NOT NULL,
  status    TEXT    NOT NULL CHECK (status IN ('active', 'inactive'))
);
CREATE INDEX IF NOT EXISTS idx_learners_tenant_name ON learners(tenant_id, name);

CREATE TABLE IF NOT EXISTS enrollments (
  id           INTEGER PRIMARY KEY,
  tenant_id    INTEGER NOT NULL REFERENCES tenants(id),
  course_id    INTEGER NOT NULL REFERENCES courses(id),
  learner_id   INTEGER NOT NULL REFERENCES learners(id),
  status       TEXT    NOT NULL CHECK (status IN ('enrolled', 'completed')),
  completed_at TEXT,
  UNIQUE (course_id, learner_id),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_enrollments_tenant_course ON enrollments(tenant_id, course_id);

CREATE TABLE IF NOT EXISTS certificates (
  id            INTEGER PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id),
  course_id     INTEGER NOT NULL REFERENCES courses(id),
  learner_id    INTEGER NOT NULL REFERENCES learners(id),
  serial        TEXT    NOT NULL UNIQUE,
  issued_at     TEXT    NOT NULL,
  issued_by     TEXT    NOT NULL REFERENCES admins(id),
  status        TEXT    NOT NULL CHECK (status IN ('valid', 'revoked')),
  revoked_at    TEXT,
  revoked_by    TEXT REFERENCES admins(id),
  revoke_reason TEXT,
  UNIQUE (tenant_id, course_id, learner_id),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revoke_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_certificates_tenant_issued ON certificates(tenant_id, issued_at);
CREATE INDEX IF NOT EXISTS idx_certificates_tenant_serial ON certificates(tenant_id, serial);

CREATE TABLE IF NOT EXISTS bulk_issue_runs (
  id              INTEGER PRIMARY KEY,
  tenant_id       INTEGER NOT NULL REFERENCES tenants(id),
  course_id       INTEGER NOT NULL REFERENCES courses(id),
  idempotency_key TEXT    NOT NULL,
  created_by      TEXT    NOT NULL REFERENCES admins(id),
  created_at      TEXT    NOT NULL,
  status          TEXT    NOT NULL CHECK (status IN ('running', 'completed')),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS bulk_issue_run_items (
  run_id         INTEGER NOT NULL REFERENCES bulk_issue_runs(id),
  learner_id     INTEGER NOT NULL REFERENCES learners(id),
  outcome        TEXT    NOT NULL CHECK (outcome IN ('pending', 'issued', 'skipped', 'failed')),
  reason         TEXT CHECK (reason IN ('already_issued', 'revoked', 'not_completed', 'learner_inactive', 'internal_error')),
  certificate_id INTEGER REFERENCES certificates(id),
  PRIMARY KEY (run_id, learner_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id             INTEGER PRIMARY KEY,
  tenant_id      INTEGER NOT NULL REFERENCES tenants(id),
  actor_id       TEXT    NOT NULL REFERENCES admins(id),
  action         TEXT    NOT NULL CHECK (action IN ('ISSUE', 'REVOKE')),
  certificate_id INTEGER NOT NULL REFERENCES certificates(id),
  course_id      INTEGER NOT NULL REFERENCES courses(id),
  learner_id     INTEGER NOT NULL REFERENCES learners(id),
  run_id         INTEGER REFERENCES bulk_issue_runs(id),
  created_at     TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_created ON audit_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_certificate ON audit_logs(certificate_id);
