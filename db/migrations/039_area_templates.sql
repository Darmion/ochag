BEGIN;

CREATE TABLE scene_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  shape text NOT NULL CHECK (shape IN ('circle', 'cone', 'square', 'line')),
  x double precision NOT NULL CHECK (abs(x) <= 1000),
  z double precision NOT NULL CHECK (abs(z) <= 1000),
  direction double precision NOT NULL DEFAULT 0 CHECK (direction >= 0 AND direction < 360),
  size_feet numeric NOT NULL CHECK (size_feet > 0 AND size_feet <= 1000),
  width_feet numeric CHECK (width_feet IS NULL OR (width_feet > 0 AND width_feet <= 100)),
  color text NOT NULL DEFAULT '#e8835a' CHECK (color ~ '^#[0-9a-f]{6}$'),
  label text CHECK (label IS NULL OR length(label) <= 100),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, scene_id) REFERENCES scenes(campaign_id, id)
);

CREATE INDEX scene_templates_scene ON scene_templates(campaign_id, scene_id);

GRANT SELECT, INSERT, DELETE
  ON scene_templates
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (39);

COMMIT;
