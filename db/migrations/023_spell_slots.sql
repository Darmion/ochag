BEGIN;

CREATE TABLE character_spell_slots (
  campaign_id uuid NOT NULL,
  character_id uuid NOT NULL,
  level integer NOT NULL CHECK (level BETWEEN 1 AND 9),
  current integer NOT NULL DEFAULT 0 CHECK (current >= 0),
  max integer NOT NULL DEFAULT 0 CHECK (max >= 0),
  PRIMARY KEY (campaign_id, character_id, level),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id)
);

CREATE TABLE srd_spell_mechanics (
  srd_index text PRIMARY KEY,
  damage_formula text,
  healing_formula text,
  updated_by uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE campaign_spells ADD COLUMN damage_formula text;
ALTER TABLE campaign_spells ADD COLUMN healing_formula text;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON character_spell_slots, srd_spell_mechanics
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (23);

COMMIT;
