BEGIN;

ALTER TABLE roll_log
  ADD COLUMN outcome jsonb CHECK (outcome IS NULL OR jsonb_typeof(outcome) = 'object');

ALTER TABLE characters
  ADD COLUMN death_successes integer NOT NULL DEFAULT 0 CHECK (death_successes BETWEEN 0 AND 3),
  ADD COLUMN death_failures integer NOT NULL DEFAULT 0 CHECK (death_failures BETWEEN 0 AND 3);

INSERT INTO schema_migrations(version) VALUES (41);

COMMIT;
