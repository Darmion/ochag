BEGIN;

ALTER TABLE characters
  ADD COLUMN inspiration boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations(version) VALUES (46);

COMMIT;
