BEGIN;

ALTER TABLE character_weapons DROP CONSTRAINT IF EXISTS character_weapons_ability_check;

ALTER TABLE character_weapons
  ADD CONSTRAINT character_weapons_ability_check CHECK (ability IN ('strength', 'dexterity', 'finesse')),
  ADD COLUMN weapon_kind text NOT NULL DEFAULT 'melee' CHECK (weapon_kind IN ('melee', 'ranged')),
  ADD COLUMN long_range_feet integer CHECK (long_range_feet BETWEEN 5 AND 2000),
  ADD COLUMN thrown_range_feet integer CHECK (thrown_range_feet BETWEEN 5 AND 1000),
  ADD COLUMN versatile_formula text CHECK (versatile_formula IS NULL OR length(versatile_formula) BETWEEN 1 AND 60),
  ADD COLUMN ammo_resource_id uuid REFERENCES character_resources(id) ON DELETE SET NULL,
  ADD COLUMN properties jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(properties) = 'array'),
  ADD COLUMN srd_index text CHECK (srd_index IS NULL OR length(srd_index) <= 64);

UPDATE character_weapons SET weapon_kind = 'ranged' WHERE range_feet > 10;

INSERT INTO schema_migrations(version) VALUES (50);

COMMIT;
