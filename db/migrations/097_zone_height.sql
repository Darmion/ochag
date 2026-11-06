ALTER TABLE scene_triggers ADD COLUMN height_feet numeric
  CHECK (height_feet IS NULL OR (height_feet > 0 AND height_feet <= 1000));

INSERT INTO schema_migrations(version) VALUES (97);
