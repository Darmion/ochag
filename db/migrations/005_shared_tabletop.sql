BEGIN;

ALTER TABLE scenes
  ADD COLUMN revision integer NOT NULL DEFAULT 1
  CHECK (revision > 0);

ALTER TABLE tokens
  ADD COLUMN revision integer NOT NULL DEFAULT 1
  CHECK (revision > 0);

CREATE INDEX tokens_scene_lookup
  ON tokens(campaign_id, scene_id);

GRANT SELECT, INSERT, UPDATE
  ON scenes, tokens
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (5);

COMMIT;