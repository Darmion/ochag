BEGIN;

ALTER TABLE scenes ADD COLUMN elevation_cells jsonb NOT NULL DEFAULT '[]'
  CHECK (jsonb_typeof(elevation_cells) = 'array' AND jsonb_array_length(elevation_cells) <= 40000);

INSERT INTO schema_migrations(version) VALUES (105);

COMMIT;
