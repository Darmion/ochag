BEGIN;

ALTER TABLE assets DROP CONSTRAINT assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check
  CHECK (kind IN (
    'scene_background', 'object_model', 'object_image', 'audio', 'art_sprite',
    'campaign_avatar', 'campaign_banner'
  ));

ALTER TABLE campaigns
  ADD COLUMN avatar_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL,
  ADD COLUMN banner_asset_id uuid REFERENCES assets(id) ON DELETE SET NULL;

INSERT INTO schema_migrations(version) VALUES (90);

COMMIT;
