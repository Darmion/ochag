BEGIN;

ALTER TABLE combat_records ALTER COLUMN scene_id DROP NOT NULL;
ALTER TABLE combat_records ADD COLUMN scene_name text
  CHECK (scene_name IS NULL OR length(scene_name) <= 200);

CREATE TABLE scene_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 200),
  package jsonb NOT NULL CHECK (jsonb_typeof(package) = 'object'),
  deleted_by uuid NOT NULL REFERENCES users(id),
  deleted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id)
);

CREATE INDEX scene_backups_campaign ON scene_backups(campaign_id, deleted_at);

GRANT SELECT, INSERT, DELETE ON scene_backups TO ttrpg_app;
GRANT DELETE ON scenes TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (103);

COMMIT;
