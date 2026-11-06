BEGIN;

ALTER TABLE initiative_entries
  ADD COLUMN moved_diagonals integer NOT NULL DEFAULT 0 CHECK (moved_diagonals >= 0);

GRANT UPDATE ON scene_templates TO ttrpg_app;

ALTER TABLE scene_walls
  ADD COLUMN style text NOT NULL DEFAULT 'stone'
    CHECK (style IN ('stone', 'brick', 'wood', 'hedge', 'rock', 'plain', 'image')),
  ADD COLUMN texture_asset_id uuid,
  ADD FOREIGN KEY (campaign_id, texture_asset_id) REFERENCES assets(campaign_id, id),
  ADD CHECK ((style = 'image') = (texture_asset_id IS NOT NULL));

ALTER TABLE characters
  ADD COLUMN spell_save_dc_override smallint CHECK (spell_save_dc_override BETWEEN 1 AND 40),
  ADD COLUMN spell_attack_override smallint CHECK (spell_attack_override BETWEEN -10 AND 30);

ALTER TABLE character_spells
  ADD COLUMN granted boolean NOT NULL DEFAULT false,
  ADD COLUMN slotless boolean NOT NULL DEFAULT false;

CREATE TABLE campaign_spell_refs (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  ref text NOT NULL CHECK (ref ~ '^([0-9a-f]{24}|dndsu:[a-z0-9_]{1,80})$'),
  source text NOT NULL CHECK (source IN ('srd', 'custom', 'skip')),
  srd_index text,
  custom_spell_id uuid,
  mapped_by uuid NOT NULL,
  mapped_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, ref),
  CHECK ((source = 'srd') = (srd_index IS NOT NULL)),
  CHECK ((source = 'custom') = (custom_spell_id IS NOT NULL)),
  FOREIGN KEY (campaign_id, custom_spell_id) REFERENCES campaign_spells(campaign_id, id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id, mapped_by) REFERENCES campaign_members(campaign_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_spell_refs TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (71);

COMMIT;
