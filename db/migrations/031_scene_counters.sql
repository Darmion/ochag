BEGIN;

CREATE TABLE scene_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  kind text NOT NULL CHECK (kind IN ('counter', 'rounds')),
  value integer NOT NULL CHECK (value BETWEEN -9999 AND 9999),
  hidden boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, scene_id) REFERENCES scenes(campaign_id, id),
  CHECK (kind <> 'rounds' OR value >= 0)
);

CREATE INDEX scene_counters_scene ON scene_counters(campaign_id, scene_id);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON scene_counters
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (31);

COMMIT;
