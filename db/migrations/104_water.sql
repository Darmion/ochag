BEGIN;

ALTER TABLE scenes ADD COLUMN water_cells jsonb NOT NULL DEFAULT '[]'
  CHECK (jsonb_typeof(water_cells) = 'array' AND jsonb_array_length(water_cells) <= 40000);

INSERT INTO schema_migrations(version) VALUES (104);

COMMIT;
