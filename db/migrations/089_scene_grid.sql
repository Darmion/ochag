BEGIN;

ALTER TABLE scenes
  ADD COLUMN grid jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(grid) = 'object');

INSERT INTO schema_migrations(version) VALUES (89);

COMMIT;
