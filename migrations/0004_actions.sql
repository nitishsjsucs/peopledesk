-- Migration 0004_actions (SPEC section 6).
CREATE TABLE pending_actions (
  id TEXT PRIMARY KEY,                       -- uuid v4
  tool TEXT NOT NULL CHECK (tool IN ('create_support_ticket','schedule_orientation_session')),
  requester_id TEXT NOT NULL REFERENCES employees(id),
  subject_employee_id TEXT NOT NULL REFERENCES employees(id),  -- who the action affects
  conversation_id TEXT REFERENCES conversations(id),
  source TEXT NOT NULL CHECK (source IN ('chat','form','mcp')),
  arguments_json TEXT NOT NULL,              -- canonical JSON of validated args
  arguments_sha256 TEXT NOT NULL,            -- integrity check only (see below), not a security control
  preview_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('awaiting_approval','executing','executed','rejected','expired','failed')),
  claim_id TEXT,                             -- uuid of the approve request that claimed the row
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT REFERENCES employees(id),
  result_json TEXT,
  error_code TEXT,
  superseded_by TEXT REFERENCES pending_actions(id)
);
CREATE INDEX idx_actions_requester ON pending_actions(requester_id, status, created_at DESC);
