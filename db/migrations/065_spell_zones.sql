BEGIN;

ALTER TABLE srd_spell_mechanics ADD COLUMN creates_zone boolean NOT NULL DEFAULT false;
ALTER TABLE campaign_spells ADD COLUMN creates_zone boolean NOT NULL DEFAULT false;

ALTER TABLE scene_triggers ADD COLUMN caster_id uuid REFERENCES characters(id) ON DELETE SET NULL;

INSERT INTO schema_migrations(version) VALUES (65);

COMMIT;
