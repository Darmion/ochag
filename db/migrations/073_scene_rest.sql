BEGIN;

ALTER TABLE scenes
  ADD COLUMN rest jsonb CHECK (rest IS NULL OR (jsonb_typeof(rest) = 'object' AND rest->>'kind' IN ('short', 'long')));

INSERT INTO schema_migrations(version) VALUES (73);

COMMIT;
