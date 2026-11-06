BEGIN;

ALTER TABLE scene_objects
  ADD COLUMN animation_name text
    CHECK (animation_name IS NULL OR length(trim(animation_name)) BETWEEN 1 AND 100);

INSERT INTO schema_migrations(version) VALUES (12);

COMMIT;
