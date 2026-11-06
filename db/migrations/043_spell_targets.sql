BEGIN;

ALTER TABLE srd_spell_mechanics
  ADD COLUMN attack_kind text CHECK (attack_kind IN ('none', 'melee', 'ranged')),
  ADD COLUMN save_ability text CHECK (save_ability IN ('none', 'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma')),
  ADD COLUMN half_on_save boolean,
  ADD COLUMN damage_type text CHECK (damage_type IN ('acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder')),
  ADD COLUMN condition_code text CHECK (condition_code IN ('none', 'blinded', 'charmed', 'deafened', 'frightened', 'incapacitated', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious')),
  ADD COLUMN condition_rounds integer CHECK (condition_rounds BETWEEN 1 AND 1000),
  ADD COLUMN condition_repeat text CHECK (condition_repeat IN ('none', 'end', 'start'));

ALTER TABLE campaign_spells
  ADD COLUMN attack_kind text CHECK (attack_kind IN ('none', 'melee', 'ranged')),
  ADD COLUMN save_ability text CHECK (save_ability IN ('none', 'strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma')),
  ADD COLUMN half_on_save boolean,
  ADD COLUMN damage_type text CHECK (damage_type IN ('acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic', 'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder')),
  ADD COLUMN condition_code text CHECK (condition_code IN ('none', 'blinded', 'charmed', 'deafened', 'frightened', 'incapacitated', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious')),
  ADD COLUMN condition_rounds integer CHECK (condition_rounds BETWEEN 1 AND 1000),
  ADD COLUMN condition_repeat text CHECK (condition_repeat IN ('none', 'end', 'start'));

ALTER TABLE characters
  ADD COLUMN spellcasting_ability text CHECK (spellcasting_ability IN ('strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'));

INSERT INTO schema_migrations(version) VALUES (43);

COMMIT;
