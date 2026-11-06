BEGIN;

CREATE TABLE roll_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  formula text NOT NULL CHECK (length(formula) BETWEEN 3 AND 12),
  entries jsonb NOT NULL CHECK (jsonb_typeof(entries) = 'array' AND jsonb_array_length(entries) BETWEEN 1 AND 100),
  secret boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id)
);

CREATE INDEX roll_tables_campaign ON roll_tables(campaign_id, name);

GRANT SELECT, INSERT, UPDATE, DELETE ON roll_tables TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (62);

COMMIT;
