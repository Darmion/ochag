BEGIN;

ALTER TABLE campaign_conditions ADD COLUMN icon_asset_id uuid;
ALTER TABLE campaign_conditions ADD CONSTRAINT campaign_conditions_icon_asset
  FOREIGN KEY (campaign_id, icon_asset_id) REFERENCES assets(campaign_id, id);

ALTER TABLE campaign_conditions ALTER COLUMN clauses DROP NOT NULL;
ALTER TABLE campaign_conditions ADD CONSTRAINT campaign_conditions_custom_clauses
  CHECK (clauses IS NOT NULL OR code !~ '^custom_');

INSERT INTO schema_migrations(version) VALUES (107);

COMMIT;
