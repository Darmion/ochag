BEGIN;

ALTER TABLE magic_items DROP CONSTRAINT magic_items_description_check;
ALTER TABLE magic_items ADD CONSTRAINT magic_items_description_check CHECK (length(description) <= 8000);
ALTER TABLE magic_items ADD COLUMN spell_index text CHECK (spell_index IS NULL OR length(spell_index) BETWEEN 1 AND 64);

UPDATE characters c SET item_category='focus'
  FROM magic_items m
  WHERE m.campaign_id = c.campaign_id AND m.character_id = c.id AND c.item_category IS NULL
    AND m.srd_index IN ('wand-of-magic-missiles', 'wand-of-web', 'staff-of-healing');

INSERT INTO schema_migrations(version) VALUES (114);

COMMIT;
