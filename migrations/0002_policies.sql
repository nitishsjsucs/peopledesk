-- Migration 0002_policies (SPEC section 6).
CREATE TABLE policy_documents (
  doc_id TEXT PRIMARY KEY CHECK (doc_id GLOB 'POL-[0-9][0-9][0-9]'),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('time_off','benefits','compensation','travel_expense',
    'remote_work','it_security','conduct','onboarding_learning','health_safety','performance')),
  audience TEXT NOT NULL CHECK (audience IN ('all','managers','hr')),
  audience_rank INTEGER NOT NULL CHECK (audience_rank IN (1,2,3)),   -- all=1, managers=2, hr=3
  owner_team TEXT NOT NULL
);

CREATE TABLE policy_versions (
  doc_id TEXT NOT NULL REFERENCES policy_documents(doc_id),
  version INTEGER NOT NULL CHECK (version >= 1),
  r2_key TEXT NOT NULL UNIQUE,               -- policies/r<rank>-<audience>/<doc_id>/v<NN>.md
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  change_summary TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  PRIMARY KEY (doc_id, version),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX idx_versions_effective ON policy_versions(effective_from, effective_to);

CREATE TABLE policy_chunks (
  id INTEGER PRIMARY KEY,                    -- FTS5 external-content rowid
  chunk_id TEXT NOT NULL UNIQUE,             -- 'POL-014@3#2'
  doc_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  title TEXT NOT NULL,
  section TEXT NOT NULL,
  text TEXT NOT NULL,
  FOREIGN KEY (doc_id, version) REFERENCES policy_versions(doc_id, version)
);

CREATE VIRTUAL TABLE policy_chunks_fts USING fts5(
  title, section, text,
  content='policy_chunks', content_rowid='id',
  tokenize='porter unicode61 remove_diacritics 2'
);
CREATE TRIGGER policy_chunks_ai AFTER INSERT ON policy_chunks BEGIN
  INSERT INTO policy_chunks_fts(rowid, title, section, text) VALUES (new.id, new.title, new.section, new.text);
END;
CREATE TRIGGER policy_chunks_ad AFTER DELETE ON policy_chunks BEGIN
  INSERT INTO policy_chunks_fts(policy_chunks_fts, rowid, title, section, text)
  VALUES ('delete', old.id, old.title, old.section, old.text);
END;
CREATE TRIGGER policy_chunks_au AFTER UPDATE ON policy_chunks BEGIN
  INSERT INTO policy_chunks_fts(policy_chunks_fts, rowid, title, section, text)
  VALUES ('delete', old.id, old.title, old.section, old.text);
  INSERT INTO policy_chunks_fts(rowid, title, section, text) VALUES (new.id, new.title, new.section, new.text);
END;
