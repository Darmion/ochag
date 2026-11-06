BEGIN;

ALTER TABLE scenes
  ADD COLUMN ambience jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(ambience) = 'object');

INSERT INTO schema_migrations(version) VALUES (91);

COMMIT;
