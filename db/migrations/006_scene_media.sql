BEGIN;

CREATE TABLE assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  kind text NOT NULL CHECK (kind IN ('scene_background','object_model')),
  content_type text NOT NULL CHECK (length(content_type) BETWEEN 1 AND 100),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  storage_key text NOT NULL UNIQUE CHECK (length(storage_key) BETWEEN 1 AND 200),
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, uploaded_by) REFERENCES campaign_members(campaign_id, user_id),
  UNIQUE (campaign_id, id)
);

CREATE INDEX assets_campaign ON assets(campaign_id);

ALTER TABLE scenes
  ADD COLUMN width_cells integer NOT NULL DEFAULT 20
    CHECK (width_cells BETWEEN 1 AND 200),
  ADD COLUMN height_cells integer NOT NULL DEFAULT 20
    CHECK (height_cells BETWEEN 1 AND 200),
  ADD COLUMN background_asset_id uuid,
  ADD FOREIGN KEY (campaign_id, background_asset_id)
    REFERENCES assets(campaign_id, id);

UPDATE scenes
SET width_cells = COALESCE(
  NULLIF(scene_document->>'cells', '')::integer,
  20
),
height_cells = COALESCE(
  NULLIF(scene_document->>'cells', '')::integer,
  20
)
WHERE scene_document ? 'cells';

GRANT SELECT, INSERT, UPDATE
  ON assets
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (6);

COMMIT;
