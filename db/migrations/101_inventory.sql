BEGIN;

ALTER TABLE characters ADD COLUMN quantity integer NOT NULL DEFAULT 1
  CHECK (quantity >= 0 AND quantity <= 1000000);
ALTER TABLE characters ADD COLUMN item_category text
  CHECK (item_category IS NULL OR item_category IN ('weapon', 'armor', 'shield', 'ammo', 'consumable', 'tools', 'focus', 'clothes', 'gear', 'treasure', 'book', 'other'));
ALTER TABLE characters ADD COLUMN item_srd text
  CHECK (item_srd IS NULL OR length(item_srd) <= 90);
ALTER TABLE characters ADD COLUMN item_wear text
  CHECK (item_wear IS NULL OR item_wear IN ('head', 'neck', 'cloak', 'body', 'hand', 'hands', 'ring', 'belt', 'feet', 'ammo'));
ALTER TABLE characters ADD COLUMN equipped_slot text
  CHECK (equipped_slot IS NULL OR equipped_slot IN ('head', 'neck', 'cloak', 'body', 'main_hand', 'off_hand', 'hands', 'ring_1', 'ring_2', 'belt', 'feet', 'ammo'));
ALTER TABLE characters ADD COLUMN item_grip text
  CHECK (item_grip IS NULL OR item_grip IN ('one', 'two'));
ALTER TABLE characters ADD COLUMN infinite boolean NOT NULL DEFAULT false;
ALTER TABLE characters ADD COLUMN item_note text
  CHECK (item_note IS NULL OR length(item_note) <= 2000);
ALTER TABLE characters ADD COLUMN doll jsonb
  CHECK (doll IS NULL OR jsonb_typeof(doll) = 'object');
ALTER TABLE characters ADD COLUMN ac_mode text NOT NULL DEFAULT 'manual'
  CHECK (ac_mode IN ('manual', 'gear'));
ALTER TABLE characters ADD CONSTRAINT characters_equipped_needs_holder
  CHECK (equipped_slot IS NULL OR (kind = 'object' AND container_id IS NOT NULL));

CREATE UNIQUE INDEX characters_equipped_slot ON characters(campaign_id, container_id, equipped_slot)
  WHERE equipped_slot IS NOT NULL;

ALTER TABLE character_weapons ADD COLUMN source_item_id uuid;
ALTER TABLE character_weapons ADD COLUMN source_auto boolean NOT NULL DEFAULT false;

UPDATE characters SET
  name = CASE name WHEN 'Стрелы (20)' THEN 'Стрелы' WHEN 'Арбалетные болты (20)' THEN 'Арбалетные болты' ELSE 'Снаряды для пращи' END,
  quantity = 20,
  price_cp = CASE WHEN price_cp IS NULL THEN NULL ELSE GREATEST(0, round(price_cp / 20.0))::int END,
  weight_lb = CASE WHEN weight_lb IS NULL THEN NULL ELSE weight_lb / 20 END,
  item_category = 'ammo',
  item_srd = CASE name WHEN 'Стрелы (20)' THEN 'gear:arrows-20' WHEN 'Арбалетные болты (20)' THEN 'gear:crossbow-bolts-20' ELSE 'gear:sling-bullets-20' END
WHERE kind = 'object' AND name IN ('Стрелы (20)', 'Арбалетные болты (20)', 'Снаряды для пращи (20)');

UPDATE character_weapons w SET source_item_id = (
  SELECT i.id FROM characters i
  WHERE i.campaign_id = w.campaign_id AND i.container_id = w.character_id AND i.kind = 'object' AND lower(i.name) = lower(w.name)
  ORDER BY i.id LIMIT 1
)
FROM characters c
WHERE c.campaign_id = w.campaign_id AND c.id = w.character_id AND c.kind = 'character' AND w.srd_index IS NOT NULL AND w.source_item_id IS NULL;

WITH prices(srd_index, price_cp, weight_lb) AS (VALUES
    ('club', 10, 2),
    ('dagger', 200, 1),
    ('greatclub', 20, 10),
    ('handaxe', 500, 2),
    ('javelin', 50, 2),
    ('light-hammer', 200, 2),
    ('mace', 500, 4),
    ('quarterstaff', 20, 4),
    ('sickle', 100, 2),
    ('spear', 100, 3),
    ('crossbow-light', 2500, 5),
    ('dart', 5, 0.25),
    ('shortbow', 2500, 2),
    ('sling', 10, 0),
    ('battleaxe', 1000, 4),
    ('flail', 1000, 2),
    ('glaive', 2000, 6),
    ('greataxe', 3000, 7),
    ('greatsword', 5000, 6),
    ('halberd', 2000, 6),
    ('lance', 1000, 6),
    ('longsword', 1500, 3),
    ('maul', 1000, 10),
    ('morningstar', 1500, 4),
    ('pike', 500, 18),
    ('rapier', 2500, 2),
    ('scimitar', 2500, 3),
    ('shortsword', 1000, 2),
    ('trident', 500, 4),
    ('war-pick', 500, 2),
    ('warhammer', 1500, 2),
    ('whip', 200, 3),
    ('blowgun', 1000, 1),
    ('crossbow-hand', 7500, 3),
    ('crossbow-heavy', 5000, 18),
    ('longbow', 5000, 2),
    ('net', 100, 3)
), pending AS MATERIALIZED (
  SELECT w.id AS weapon_id, gen_random_uuid() AS item_id, w.campaign_id, w.character_id, c.owner_user_id, w.name, w.srd_index, p.price_cp, p.weight_lb
  FROM character_weapons w
  JOIN characters c ON c.campaign_id = w.campaign_id AND c.id = w.character_id
  JOIN prices p ON p.srd_index = w.srd_index
  WHERE c.kind = 'character' AND w.source_item_id IS NULL
), made AS (
  INSERT INTO characters (id, campaign_id, owner_user_id, name, kind, size, container_id, price_cp, weight_lb, quantity, item_category, item_srd)
  SELECT item_id, campaign_id, owner_user_id, name, 'object', 'tiny', character_id, price_cp, weight_lb, 1, 'weapon', 'weapon:' || srd_index
  FROM pending
  RETURNING id
)
UPDATE character_weapons w SET source_item_id = pending.item_id
FROM pending
WHERE w.id = pending.weapon_id AND pending.item_id IN (SELECT id FROM made);

INSERT INTO schema_migrations(version) VALUES (101);

COMMIT;
