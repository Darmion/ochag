BEGIN;

CREATE TABLE scene_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('enter', 'open')),
  shape text CHECK (shape IN ('circle', 'cone', 'square', 'line')),
  x double precision CHECK (x IS NULL OR abs(x) <= 1000),
  z double precision CHECK (z IS NULL OR abs(z) <= 1000),
  direction double precision NOT NULL DEFAULT 0 CHECK (direction >= 0 AND direction < 360),
  size_feet numeric CHECK (size_feet IS NULL OR (size_feet > 0 AND size_feet <= 1000)),
  object_id uuid,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  message text CHECK (message IS NULL OR length(message) <= 500),
  check_kind text CHECK (check_kind IN ('save', 'skill')),
  check_key text CHECK (check_key IS NULL OR length(check_key) <= 64),
  dc integer CHECK (dc BETWEEN 1 AND 40),
  damage_formula text CHECK (damage_formula IS NULL OR length(damage_formula) BETWEEN 1 AND 100),
  damage_type text CHECK (damage_type IS NULL OR length(damage_type) <= 32),
  half_on_success boolean NOT NULL DEFAULT true,
  once boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true,
  secret boolean NOT NULL DEFAULT false,
  fired_count integer NOT NULL DEFAULT 0 CHECK (fired_count >= 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, scene_id) REFERENCES scenes(campaign_id, id),
  FOREIGN KEY (campaign_id, object_id) REFERENCES characters(campaign_id, id),
  CHECK ((kind = 'enter') = (shape IS NOT NULL AND x IS NOT NULL AND z IS NOT NULL AND size_feet IS NOT NULL)),
  CHECK ((kind = 'open') = (object_id IS NOT NULL)),
  CHECK ((check_kind IS NULL AND check_key IS NULL AND dc IS NULL)
      OR (check_kind IS NOT NULL AND check_key IS NOT NULL AND dc IS NOT NULL))
);

CREATE INDEX scene_triggers_scene ON scene_triggers(campaign_id, scene_id);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON scene_triggers
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (40);

COMMIT;
