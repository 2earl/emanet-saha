-- Emanet Saha: sign-in only. Agents, claims, evidence and payouts live in emanet-core; photos in R2.

-- A sign-in with login in progress: at most 10 minutes, used once. Only an HMAC of the cookie.
CREATE TABLE signin_tx (
  id_hash       TEXT PRIMARY KEY,
  state         TEXT NOT NULL,
  pkce_verifier TEXT NOT NULL,
  return_to     TEXT,
  second_factor INTEGER NOT NULL DEFAULT 0,
  expires_at    INTEGER NOT NULL
) STRICT;

-- Agents' sessions: 7 days idle, 30 days absolute. Only an HMAC of the cookie is stored.
CREATE TABLE web_sessions (
  id_hash      TEXT PRIMARY KEY,
  uid          TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  aal2_at      INTEGER
) STRICT;
CREATE INDEX web_sessions_uid ON web_sessions (uid);
