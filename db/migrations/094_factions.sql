BEGIN;

CREATE TABLE factions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  color text NOT NULL DEFAULT '#c9a45c' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  system text CHECK (system IN ('party', 'enemies')),
  rights text[] NOT NULL DEFAULT '{}',
  bonuses jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(bonuses) = 'array'),
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  UNIQUE (campaign_id, system)
);

ALTER TABLE characters ADD COLUMN factions_explicit boolean NOT NULL DEFAULT false;

CREATE TABLE faction_members (
  campaign_id uuid NOT NULL,
  faction_id uuid NOT NULL,
  character_id uuid NOT NULL,
  PRIMARY KEY (faction_id, character_id),
  FOREIGN KEY (campaign_id, faction_id) REFERENCES factions(campaign_id, id),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id)
);
CREATE INDEX faction_members_character ON faction_members (campaign_id, character_id);

CREATE TABLE faction_relations (
  campaign_id uuid NOT NULL,
  faction_a uuid NOT NULL,
  faction_b uuid NOT NULL,
  relation text NOT NULL CHECK (relation IN ('ally', 'neutral', 'enemy')),
  restrictions text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (campaign_id, faction_a, faction_b),
  CHECK (faction_a < faction_b),
  FOREIGN KEY (campaign_id, faction_a) REFERENCES factions(campaign_id, id),
  FOREIGN KEY (campaign_id, faction_b) REFERENCES factions(campaign_id, id)
);

INSERT INTO factions (campaign_id, name, color, system, rights, sort)
SELECT id, 'Отряд', '#5ea764', 'party', ARRAY['shared-vision', 'see-hp'], 0 FROM campaigns;
INSERT INTO factions (campaign_id, name, color, system, rights, sort)
SELECT id, 'Враги', '#cf4a3d', 'enemies', '{}', 1 FROM campaigns;
INSERT INTO faction_relations (campaign_id, faction_a, faction_b, relation)
SELECT party.campaign_id, LEAST(party.id, enemies.id), GREATEST(party.id, enemies.id), 'enemy'
FROM factions party JOIN factions enemies ON enemies.campaign_id = party.campaign_id AND enemies.system = 'enemies'
WHERE party.system = 'party';

GRANT SELECT, INSERT, UPDATE, DELETE ON factions TO ttrpg_app;
GRANT SELECT, INSERT, DELETE ON faction_members TO ttrpg_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON faction_relations TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (94);

COMMIT;
