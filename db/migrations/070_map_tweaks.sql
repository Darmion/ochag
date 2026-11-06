BEGIN;

ALTER TABLE scenes
  ADD COLUMN background_rotation smallint NOT NULL DEFAULT 0
    CHECK (background_rotation IN (0, 90, 180, 270));

GRANT UPDATE (text, color, points) ON scene_drawings TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (70);

COMMIT;
