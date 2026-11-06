BEGIN;

ALTER TABLE characters
  ADD COLUMN damage_threshold integer CHECK (damage_threshold BETWEEN 0 AND 1000);

INSERT INTO schema_migrations(version) VALUES (37);

COMMIT;
