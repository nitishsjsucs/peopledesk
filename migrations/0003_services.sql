-- Migration 0003_services (SPEC section 6).
CREATE TABLE tickets (
  id TEXT PRIMARY KEY CHECK (id GLOB 'TKT-[0-9][0-9][0-9][0-9][0-9][0-9]'),
  requester_id TEXT NOT NULL REFERENCES employees(id),
  category TEXT NOT NULL CHECK (category IN ('it','payroll','benefits','facilities','hr_general','access_request')),
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low','normal','high')),
  status TEXT NOT NULL CHECK (status IN ('open','in_progress','resolved','closed')),
  related_policy_id TEXT REFERENCES policy_documents(doc_id),
  created_via TEXT NOT NULL CHECK (created_via IN ('seed','chat','form','mcp')),
  action_id TEXT UNIQUE,                     -- pending_actions.id that created it (idempotency)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tickets_requester ON tickets(requester_id, status, created_at DESC);

CREATE TABLE onboarding_plans (
  employee_id TEXT PRIMARY KEY REFERENCES employees(id),
  buddy_id TEXT REFERENCES employees(id),
  start_date TEXT NOT NULL,
  target_completion_date TEXT NOT NULL
);

CREATE TABLE onboarding_tasks (
  id TEXT PRIMARY KEY,                       -- 'ONB-E0042-07'
  employee_id TEXT NOT NULL REFERENCES onboarding_plans(employee_id),
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('paperwork','it_setup','training','meet_people','orientation')),
  owner_role TEXT NOT NULL CHECK (owner_role IN ('employee','manager','hr_admin','it')),
  due_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','in_progress','done','blocked')),
  completed_at TEXT
);
CREATE INDEX idx_onboarding_tasks_employee ON onboarding_tasks(employee_id, ordinal);

CREATE TABLE orientation_sessions (
  id TEXT PRIMARY KEY CHECK (id GLOB 'ORI-[0-9][0-9][0-9]'),
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,                   -- ISO 8601 UTC
  duration_min INTEGER NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('virtual','in_person')),
  region TEXT NOT NULL CHECK (region IN ('US','IN','UK','GLOBAL')),
  location TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  facilitator_id TEXT NOT NULL REFERENCES employees(id)
);

CREATE TABLE orientation_bookings (
  id TEXT PRIMARY KEY,                       -- 'BKG-<uuid>'
  session_id TEXT NOT NULL REFERENCES orientation_sessions(id),
  employee_id TEXT NOT NULL UNIQUE REFERENCES employees(id),   -- one orientation per employee
  booked_by TEXT NOT NULL REFERENCES employees(id),
  action_id TEXT UNIQUE,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_bookings_session ON orientation_bookings(session_id);
