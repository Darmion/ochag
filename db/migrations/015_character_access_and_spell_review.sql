BEGIN;

CREATE TABLE character_access_grants (
  campaign_id uuid NOT NULL,
  character_id uuid NOT NULL,
  user_id uuid NOT NULL,
  level text NOT NULL CHECK (level IN ('denied', 'edit')),
  granted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, character_id, user_id),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id),
  FOREIGN KEY (campaign_id, user_id) REFERENCES campaign_members(campaign_id, user_id)
);

CREATE INDEX character_access_grants_character
  ON character_access_grants(campaign_id, character_id);

ALTER TABLE campaign_spells ADD COLUMN status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'approved', 'rejected'));
ALTER TABLE campaign_spells ADD COLUMN reviewed_by uuid;
ALTER TABLE campaign_spells ADD COLUMN reviewed_at timestamptz;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON character_access_grants
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (15);

COMMIT;
