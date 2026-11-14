BEGIN;

ALTER TABLE characters ADD COLUMN image_open_asset_id uuid;
ALTER TABLE characters ADD CONSTRAINT characters_image_open_asset
  FOREIGN KEY (campaign_id, image_open_asset_id) REFERENCES assets(campaign_id, id);

ALTER TABLE scene_triggers ADD COLUMN spell jsonb
  CHECK (spell IS NULL OR jsonb_typeof(spell) = 'object');

ALTER TABLE scene_templates ADD COLUMN height_feet numeric
  CHECK (height_feet IS NULL OR (height_feet > 0 AND height_feet <= 1000));

INSERT INTO schema_migrations(version) VALUES (102);

COMMIT;
