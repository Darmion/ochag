BEGIN;

ALTER TABLE object_states
  ADD COLUMN light_cone boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations(version) VALUES (74);

COMMIT;
