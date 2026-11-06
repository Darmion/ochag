BEGIN;

ALTER TABLE characters
  ADD COLUMN long_rest_at integer CHECK (long_rest_at IS NULL OR long_rest_at >= 0);

INSERT INTO schema_migrations(version) VALUES (67);

COMMIT;
