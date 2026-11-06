BEGIN;

CREATE TABLE scene_drawings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('path', 'text')),
  layer text NOT NULL DEFAULT 'all' CHECK (layer IN ('all', 'gm')),
  color text NOT NULL CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  width numeric NOT NULL DEFAULT 0.08 CHECK (width > 0 AND width <= 1),
  points jsonb NOT NULL CHECK (jsonb_typeof(points) = 'array'),
  text text CHECK (text IS NULL OR length(trim(text)) BETWEEN 1 AND 200),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'text') = (text IS NOT NULL)),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, scene_id) REFERENCES scenes(campaign_id, id)
);

CREATE INDEX scene_drawings_scene ON scene_drawings(campaign_id, scene_id);

GRANT SELECT, INSERT, DELETE
  ON scene_drawings
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (26);

COMMIT;
