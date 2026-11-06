BEGIN;

ALTER TABLE scene_objects ADD COLUMN shared boolean NOT NULL DEFAULT false;
ALTER TABLE characters ADD COLUMN shared boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations(version) VALUES (19);

COMMIT;
