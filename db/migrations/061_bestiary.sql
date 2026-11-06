BEGIN;

ALTER TABLE character_weapons
  ADD COLUMN attack_bonus integer NOT NULL DEFAULT 0 CHECK (attack_bonus BETWEEN -10 AND 20),
  ADD COLUMN extra_damage_formula text CHECK (extra_damage_formula IS NULL OR length(extra_damage_formula) BETWEEN 1 AND 60),
  ADD COLUMN extra_damage_type text CHECK (extra_damage_type IS NULL OR extra_damage_type IN (
    'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
    'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder'
  ));

INSERT INTO schema_migrations(version) VALUES (61);

COMMIT;
