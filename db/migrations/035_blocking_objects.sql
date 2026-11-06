BEGIN;

ALTER TABLE object_states
  ADD COLUMN blocks boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations(version) VALUES (35);

COMMIT;
