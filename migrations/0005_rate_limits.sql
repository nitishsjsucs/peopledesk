-- Migration 0005_rate_limits: fixed-window counters for the limits on chat turns and new
-- conversations (src/worker/services/rate-limit.ts, CHAT_RATE_LIMITS). One row per subject, bucket and
-- window; expired windows are deleted by the next check from the same subject.
CREATE TABLE rate_limits (
  subject TEXT NOT NULL,                     -- employee id, or '*' for an account-wide rule
  bucket TEXT NOT NULL CHECK (bucket IN ('turn','conversation')),
  window_seconds INTEGER NOT NULL CHECK (window_seconds > 0),
  window_start INTEGER NOT NULL,             -- unix seconds, a multiple of window_seconds
  count INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (subject, bucket, window_seconds, window_start)
) WITHOUT ROWID;
