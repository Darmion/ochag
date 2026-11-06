BEGIN;

ALTER TABLE assets DROP CONSTRAINT assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check
  CHECK (kind IN ('scene_background', 'object_model', 'object_image', 'audio'));

CREATE TABLE campaign_audio (
  campaign_id uuid PRIMARY KEY REFERENCES campaigns(id),
  asset_id uuid,
  playing boolean NOT NULL DEFAULT false,
  loop boolean NOT NULL DEFAULT true,
  volume numeric NOT NULL DEFAULT 0.8 CHECK (volume >= 0 AND volume <= 1),
  started_at timestamptz,
  paused_at_seconds double precision NOT NULL DEFAULT 0 CHECK (paused_at_seconds >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, asset_id) REFERENCES assets(campaign_id, id),
  CHECK (NOT playing OR (asset_id IS NOT NULL AND started_at IS NOT NULL))
);

GRANT SELECT, INSERT, UPDATE
  ON campaign_audio
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (28);

COMMIT;
