BEGIN;

CREATE TABLE character_field_visibility (
  campaign_id uuid NOT NULL,
  character_id uuid NOT NULL,
  field_key text NOT NULL CHECK (length(field_key) BETWEEN 1 AND 100),
  mode text NOT NULL CHECK (mode IN ('hidden','allowlist')),
  PRIMARY KEY (campaign_id, character_id, field_key),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id)
);

CREATE TABLE character_field_visibility_grants (
  campaign_id uuid NOT NULL,
  character_id uuid NOT NULL,
  field_key text NOT NULL,
  user_id uuid NOT NULL,
  PRIMARY KEY (campaign_id, character_id, field_key, user_id),
  FOREIGN KEY (campaign_id, character_id, field_key)
    REFERENCES character_field_visibility(campaign_id, character_id, field_key) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id, user_id) REFERENCES campaign_members(campaign_id, user_id)
);

CREATE INDEX character_field_visibility_character
  ON character_field_visibility(campaign_id, character_id);
CREATE INDEX character_field_visibility_grants_field
  ON character_field_visibility_grants(campaign_id, character_id, field_key);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON character_field_visibility, character_field_visibility_grants
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (14);

COMMIT;
