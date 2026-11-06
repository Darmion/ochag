BEGIN;

ALTER TABLE character_weapons
  ADD COLUMN damage_formula text CHECK (damage_formula IS NULL OR length(damage_formula) BETWEEN 1 AND 60),
  ADD COLUMN damage_type text CHECK (damage_type IS NULL OR damage_type IN (
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
    'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'
  )),
  ADD COLUMN range_feet integer NOT NULL DEFAULT 5 CHECK (range_feet BETWEEN 5 AND 1000);

ALTER TABLE characters
  ADD COLUMN damage_resistances jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(damage_resistances) = 'array'),
  ADD COLUMN damage_immunities jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(damage_immunities) = 'array'),
  ADD COLUMN damage_vulnerabilities jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(damage_vulnerabilities) = 'array');

INSERT INTO schema_migrations(version) VALUES (42);

COMMIT;
