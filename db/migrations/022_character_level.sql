BEGIN;

ALTER TABLE characters ADD COLUMN level integer CHECK (level BETWEEN 1 AND 20);

INSERT INTO schema_migrations(version) VALUES (22);

COMMIT;
