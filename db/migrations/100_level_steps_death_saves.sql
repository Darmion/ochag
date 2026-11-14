BEGIN;

ALTER TABLE characters ADD COLUMN level_steps jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(level_steps) = 'array');
ALTER TABLE characters ADD COLUMN auto_death_saves boolean NOT NULL DEFAULT true;

INSERT INTO schema_migrations(version) VALUES (100);

COMMIT;
