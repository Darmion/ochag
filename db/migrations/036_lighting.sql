BEGIN;

ALTER TABLE scenes
  ADD COLUMN lighting text NOT NULL DEFAULT 'bright'
    CHECK (lighting IN ('bright', 'dim', 'dark'));

ALTER TABLE object_states
  ADD COLUMN light_bright_feet integer CHECK (light_bright_feet BETWEEN 0 AND 1000),
  ADD COLUMN light_dim_feet integer CHECK (light_dim_feet BETWEEN 0 AND 1000),
  ADD COLUMN lit boolean NOT NULL DEFAULT true;

INSERT INTO schema_migrations(version) VALUES (36);

COMMIT;
