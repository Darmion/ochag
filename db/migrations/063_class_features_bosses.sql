BEGIN;

ALTER TABLE characters
  ADD COLUMN legendary_actions smallint NOT NULL DEFAULT 0 CHECK (legendary_actions BETWEEN 0 AND 5),
  ADD COLUMN legendary_options jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(legendary_options) = 'array' AND jsonb_array_length(legendary_options) <= 10),
  ADD COLUMN boss_phases jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(boss_phases) = 'array' AND jsonb_array_length(boss_phases) <= 5);

ALTER TABLE initiative_entries
  ADD COLUMN legendary_used smallint NOT NULL DEFAULT 0 CHECK (legendary_used BETWEEN 0 AND 5),
  ADD COLUMN sneak_attack_used boolean NOT NULL DEFAULT false,
  ADD COLUMN action_surged boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations(version) VALUES (63);

COMMIT;
