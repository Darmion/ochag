BEGIN;

CREATE TABLE magic_items (
  campaign_id uuid NOT NULL,
  character_id uuid NOT NULL,
  rarity text NOT NULL DEFAULT 'uncommon' CHECK (rarity IN ('common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact')),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  requires_attunement boolean NOT NULL DEFAULT false,
  attuned_to uuid,
  equipped boolean NOT NULL DEFAULT false,
  charges_max smallint CHECK (charges_max IS NULL OR charges_max BETWEEN 1 AND 100),
  charges_current smallint CHECK (charges_current IS NULL OR charges_current >= 0),
  recharge text CHECK (recharge IS NULL OR recharge IN ('dawn', 'short', 'long')),
  recharge_formula text CHECK (recharge_formula IS NULL OR length(recharge_formula) BETWEEN 1 AND 20),
  destroy_on_empty boolean NOT NULL DEFAULT false,
  destroyed boolean NOT NULL DEFAULT false,
  recharged_dawn integer NOT NULL DEFAULT 0 CHECK (recharged_dawn >= 0),
  bonuses jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(bonuses) = 'object'),
  applied jsonb CHECK (applied IS NULL OR jsonb_typeof(applied) = 'object'),
  srd_index text CHECK (srd_index IS NULL OR length(srd_index) BETWEEN 1 AND 64),
  PRIMARY KEY (campaign_id, character_id),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id),
  CHECK (charges_current IS NULL OR (charges_max IS NOT NULL AND charges_current <= charges_max))
);

CREATE INDEX magic_items_attuned ON magic_items(campaign_id, attuned_to) WHERE attuned_to IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON magic_items TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (64);

COMMIT;
