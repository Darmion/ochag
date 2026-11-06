BEGIN;

ALTER TABLE initiative_entries
  ADD COLUMN moved_feet numeric NOT NULL DEFAULT 0 CHECK (moved_feet >= 0),
  ADD COLUMN dashes integer NOT NULL DEFAULT 0 CHECK (dashes BETWEEN 0 AND 10);

ALTER TABLE scenes
  ADD COLUMN difficult_cells jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(difficult_cells) = 'array');

INSERT INTO schema_migrations(version) VALUES (38);

COMMIT;
