BEGIN;

CREATE TABLE combat_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  scene_id uuid NOT NULL,
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  ended_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, scene_id) REFERENCES scenes(campaign_id, id)
);

CREATE INDEX combat_records_time ON combat_records(campaign_id, ended_at);

CREATE TABLE chronicle_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(body) <= 20000),
  started_at timestamptz,
  ended_at timestamptz NOT NULL DEFAULT now(),
  published boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id)
);

ALTER TABLE campaigns
  ADD COLUMN session_started_at timestamptz,
  ADD COLUMN session_start_minutes integer;

GRANT SELECT, INSERT, UPDATE, DELETE ON combat_records, chronicle_entries TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (60);

COMMIT;
