BEGIN;

ALTER TABLE characters
  ADD COLUMN class_name text CHECK (class_name IS NULL OR length(class_name) <= 100),
  ADD COLUMN attacks_per_action integer CHECK (attacks_per_action BETWEEN 1 AND 10);

INSERT INTO schema_migrations(version) VALUES (49);

COMMIT;
