BEGIN;

CREATE TABLE campaign_art (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  key text NOT NULL CHECK (length(key) BETWEEN 3 AND 200),
  value text NOT NULL CHECK (length(value) BETWEEN 1 AND 300),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_art TO ttrpg_app;

ALTER TABLE assets DROP CONSTRAINT assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check
  CHECK (kind IN ('scene_background', 'object_model', 'object_image', 'audio', 'art_sprite'));
GRANT DELETE ON assets TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (86);

COMMIT;
