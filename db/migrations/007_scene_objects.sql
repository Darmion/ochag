BEGIN;

ALTER TABLE assets
  ADD COLUMN original_filename text
    CHECK (original_filename IS NULL OR length(original_filename) BETWEEN 1 AND 200);

CREATE TABLE scene_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  parent_object_id uuid,
  x double precision NOT NULL DEFAULT 0,
  y double precision NOT NULL DEFAULT 0,
  z double precision NOT NULL DEFAULT 0,
  rotation_y double precision NOT NULL DEFAULT 0
    CHECK (rotation_y >= 0 AND rotation_y < 360),
  scale numeric NOT NULL DEFAULT 1 CHECK (scale > 0 AND scale <= 50),
  snap_to_grid boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, scene_id) REFERENCES scenes(campaign_id, id),
  FOREIGN KEY (campaign_id, asset_id) REFERENCES assets(campaign_id, id),
  FOREIGN KEY (campaign_id, owner_user_id) REFERENCES campaign_members(campaign_id, user_id),
  FOREIGN KEY (campaign_id, parent_object_id) REFERENCES scene_objects(campaign_id, id),
  CHECK (parent_object_id IS NULL OR parent_object_id <> id)
);

CREATE INDEX scene_objects_scene ON scene_objects(campaign_id, scene_id);
CREATE INDEX scene_objects_parent ON scene_objects(campaign_id, parent_object_id)
  WHERE parent_object_id IS NOT NULL;

CREATE TABLE scene_object_grants (
  campaign_id uuid NOT NULL,
  scene_object_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scene_object_id, user_id),
  FOREIGN KEY (campaign_id, scene_object_id) REFERENCES scene_objects(campaign_id, id),
  FOREIGN KEY (campaign_id, user_id) REFERENCES campaign_members(campaign_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON scene_objects, scene_object_grants
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (7);

COMMIT;
