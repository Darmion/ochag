BEGIN;

ALTER TABLE scene_triggers
  ADD COLUMN detect_dc integer CHECK (detect_dc BETWEEN 1 AND 40),
  ADD COLUMN detected boolean NOT NULL DEFAULT false;

ALTER TABLE object_states
  ADD COLUMN secret_dc integer CHECK (secret_dc BETWEEN 1 AND 40),
  ADD COLUMN secret_found boolean NOT NULL DEFAULT false,
  ADD COLUMN passage_scene_id uuid,
  ADD COLUMN passage_target_id uuid;

INSERT INTO schema_migrations(version) VALUES (53);

COMMIT;
