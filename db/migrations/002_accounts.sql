BEGIN;
CREATE TABLE accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,32}$'),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  user_id uuid NOT NULL REFERENCES accounts(user_id),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE campaign_invites (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  created_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  used_by uuid REFERENCES users(id),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id,created_by) REFERENCES campaign_members(campaign_id,user_id),
  CHECK ((used_by IS NULL) = (used_at IS NULL))
);
CREATE INDEX campaign_invites_campaign ON campaign_invites(campaign_id);
INSERT INTO schema_migrations(version) VALUES (2);
COMMIT;
