BEGIN;

ALTER TABLE characters
  ADD COLUMN legendary_resistances smallint NOT NULL DEFAULT 0
  CHECK (legendary_resistances BETWEEN 0 AND 5);
ALTER TABLE initiative_entries ADD COLUMN turn_flags text[] NOT NULL DEFAULT '{}';

INSERT INTO schema_migrations(version) VALUES (82);

COMMIT;
