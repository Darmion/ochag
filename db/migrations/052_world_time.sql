BEGIN;

ALTER TABLE campaigns
  ADD COLUMN world_minutes integer NOT NULL DEFAULT 480 CHECK (world_minutes >= 0);

ALTER TABLE scenes
  ADD COLUMN sky text NOT NULL DEFAULT 'fixed' CHECK (sky IN ('fixed', 'clock')),
  ADD COLUMN weather text NOT NULL DEFAULT 'clear' CHECK (weather IN ('clear', 'rain', 'storm', 'snow', 'fog'));

ALTER TABLE object_states
  ADD COLUMN light_open_flame boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations(version) VALUES (52);

COMMIT;
