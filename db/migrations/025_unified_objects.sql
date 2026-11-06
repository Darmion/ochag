BEGIN;

ALTER TABLE assets DROP CONSTRAINT assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check
  CHECK (kind IN ('scene_background', 'object_model', 'object_image'));

ALTER TABLE characters
  ADD COLUMN kind text NOT NULL DEFAULT 'character'
    CHECK (kind IN ('character', 'npc', 'object')),
  ADD COLUMN disposition text
    CHECK (disposition IN ('hostile', 'neutral', 'friendly')),
  ADD COLUMN size text NOT NULL DEFAULT 'medium'
    CHECK (size IN ('tiny', 'small', 'medium', 'large', 'huge', 'gargantuan')),
  ADD COLUMN model_asset_id uuid,
  ADD COLUMN image_asset_id uuid,
  ADD CONSTRAINT characters_disposition_only_npc
    CHECK ((kind = 'npc') = (disposition IS NOT NULL)),
  ADD CONSTRAINT characters_model_asset
    FOREIGN KEY (campaign_id, model_asset_id) REFERENCES assets(campaign_id, id),
  ADD CONSTRAINT characters_image_asset
    FOREIGN KEY (campaign_id, image_asset_id) REFERENCES assets(campaign_id, id);

CREATE INDEX characters_kind ON characters(campaign_id, kind);

DROP TABLE scene_object_grants;
DROP TABLE scene_objects;
DROP TABLE tokens;

CREATE TABLE scene_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  scene_id uuid NOT NULL,
  character_id uuid NOT NULL,
  parent_object_id uuid,
  x double precision NOT NULL DEFAULT 0,
  y double precision NOT NULL DEFAULT 0,
  z double precision NOT NULL DEFAULT 0,
  rotation_y double precision NOT NULL DEFAULT 0
    CHECK (rotation_y >= 0 AND rotation_y < 360),
  scale numeric NOT NULL DEFAULT 1 CHECK (scale > 0 AND scale <= 50),
  snap_to_grid boolean NOT NULL DEFAULT true,
  animation_name text
    CHECK (animation_name IS NULL OR length(trim(animation_name)) BETWEEN 1 AND 100),
  hidden boolean NOT NULL DEFAULT false,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  UNIQUE (scene_id, character_id),
  FOREIGN KEY (campaign_id, scene_id) REFERENCES scenes(campaign_id, id),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id),
  FOREIGN KEY (campaign_id, parent_object_id) REFERENCES scene_objects(campaign_id, id),
  CHECK (parent_object_id IS NULL OR parent_object_id <> id)
);

CREATE INDEX scene_objects_scene ON scene_objects(campaign_id, scene_id);
CREATE INDEX scene_objects_character ON scene_objects(campaign_id, character_id);
CREATE INDEX scene_objects_parent ON scene_objects(campaign_id, parent_object_id)
  WHERE parent_object_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON scene_objects
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (25);

COMMIT;
