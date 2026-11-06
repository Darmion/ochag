BEGIN;

ALTER TABLE scenes
  ADD COLUMN default_vision_radius_feet numeric
    CHECK (default_vision_radius_feet > 0);

CREATE TABLE scene_walls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  x1 double precision NOT NULL,
  z1 double precision NOT NULL,
  x2 double precision NOT NULL,
  z2 double precision NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, scene_id) REFERENCES scenes(campaign_id, id),
  FOREIGN KEY (campaign_id, created_by) REFERENCES campaign_members(campaign_id, user_id),
  CHECK (x1 <> x2 OR z1 <> z2)
);

CREATE INDEX scene_walls_scene ON scene_walls(campaign_id, scene_id);

CREATE TABLE scene_fog_state (
  campaign_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  user_id uuid NOT NULL,
  explored_cells jsonb NOT NULL DEFAULT '[]'
    CHECK (jsonb_typeof(explored_cells) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, scene_id, user_id),
  FOREIGN KEY (campaign_id, scene_id) REFERENCES scenes(campaign_id, id),
  FOREIGN KEY (campaign_id, user_id) REFERENCES campaign_members(campaign_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON scene_walls, scene_fog_state
  TO ttrpg_app;

GRANT SELECT
  ON character_effects, character_vision_overrides
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (8);

COMMIT;
