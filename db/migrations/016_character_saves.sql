BEGIN;

CREATE TABLE character_saves (
  campaign_id uuid NOT NULL,
  character_id uuid NOT NULL,
  ability text NOT NULL CHECK (ability IN ('strength','dexterity','constitution','intelligence','wisdom','charisma')),
  proficient boolean NOT NULL DEFAULT false,
  custom_bonus integer NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, character_id, ability),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id)
);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON character_saves
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (16);

COMMIT;
