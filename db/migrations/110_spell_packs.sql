BEGIN;

ALTER TABLE campaign_spells ADD COLUMN pack_id text CHECK (pack_id IS NULL OR length(pack_id) BETWEEN 2 AND 64);
ALTER TABLE campaign_spells ADD COLUMN pack_spell text CHECK (pack_spell IS NULL OR length(pack_spell) BETWEEN 1 AND 200);
ALTER TABLE campaign_spells ADD CONSTRAINT campaign_spells_pack_pair CHECK ((pack_id IS NULL) = (pack_spell IS NULL));
CREATE UNIQUE INDEX campaign_spells_pack ON campaign_spells(campaign_id, pack_id, pack_spell) WHERE pack_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES (110);

COMMIT;
