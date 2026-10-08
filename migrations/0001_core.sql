-- Migration 0001_core (SPEC section 6).
CREATE TABLE employees (
  id TEXT PRIMARY KEY CHECK (id GLOB 'E[0-9][0-9][0-9][0-9]'),
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employee','manager','hr_admin')),
  department TEXT NOT NULL,
  region TEXT NOT NULL CHECK (region IN ('US','IN','UK')),
  job_title TEXT NOT NULL,
  manager_id TEXT REFERENCES employees(id),
  start_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE INDEX idx_employees_manager ON employees(manager_id);

-- Real Access users and Access service tokens mapped onto seeded employees (empty in seed).
CREATE TABLE identity_links (
  identity TEXT PRIMARY KEY,                 -- lowercased email, or service token common_name
  kind TEXT NOT NULL CHECK (kind IN ('email','service_token')),
  employee_id TEXT NOT NULL REFERENCES employees(id),
  created_at TEXT NOT NULL
);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,                       -- uuid v4
  employee_id TEXT NOT NULL REFERENCES employees(id),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_conversations_owner ON conversations(employee_id, updated_at DESC);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('tool_call','authz_denied','action_proposed','action_approved',
    'action_rejected','action_executed','action_failed','policy_viewed')),
  tool TEXT,
  target TEXT,
  outcome TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_audit_actor ON audit_log(actor_id, at);

-- Which generated dataset is seeded; read by /api/health and checked by the eval runner.
CREATE TABLE dataset_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  as_of TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  sha256 TEXT NOT NULL
);
