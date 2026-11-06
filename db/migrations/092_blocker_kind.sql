BEGIN;

ALTER TABLE object_states
  ADD COLUMN block_kind text NOT NULL DEFAULT 'both' CHECK (block_kind IN ('both', 'sight', 'move'));

INSERT INTO schema_migrations(version) VALUES (92);

COMMIT;
