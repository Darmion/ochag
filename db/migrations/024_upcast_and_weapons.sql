BEGIN;

ALTER TABLE campaign_spells ADD COLUMN upcast_formula text;
ALTER TABLE srd_spell_mechanics ADD COLUMN upcast_formula text;

CREATE TABLE character_weapons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  character_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 100),
  ability text NOT NULL CHECK (ability IN ('strength', 'dexterity')),
  proficient boolean NOT NULL DEFAULT true,
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id)
);

CREATE INDEX character_weapons_character ON character_weapons(campaign_id, character_id);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON character_weapons
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (24);

COMMIT;
