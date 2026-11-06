BEGIN;

ALTER TABLE object_states
  ADD COLUMN hazard jsonb CHECK (hazard IS NULL OR jsonb_typeof(hazard) = 'object');

ALTER TABLE scene_triggers
  ADD COLUMN on_turn boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations(version) VALUES (58);

COMMIT;
