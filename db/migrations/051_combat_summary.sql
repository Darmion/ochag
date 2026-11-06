BEGIN;

ALTER TABLE scenes
  ADD COLUMN combat_started_at timestamptz,
  ADD COLUMN combat_xp_start jsonb CHECK (combat_xp_start IS NULL OR jsonb_typeof(combat_xp_start) = 'object'),
  ADD COLUMN last_combat_summary jsonb CHECK (last_combat_summary IS NULL OR jsonb_typeof(last_combat_summary) = 'object');

INSERT INTO schema_migrations(version) VALUES (51);

COMMIT;
