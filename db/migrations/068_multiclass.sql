BEGIN;

ALTER TABLE characters
  ADD COLUMN hit_dice_spent_by_die jsonb CHECK (hit_dice_spent_by_die IS NULL OR jsonb_typeof(hit_dice_spent_by_die) = 'object'),
  ADD COLUMN pact_slots_max smallint CHECK (pact_slots_max IS NULL OR pact_slots_max BETWEEN 0 AND 4),
  ADD COLUMN pact_slots_current smallint CHECK (pact_slots_current IS NULL OR pact_slots_current >= 0),
  ADD COLUMN pact_slot_level smallint CHECK (pact_slot_level IS NULL OR pact_slot_level BETWEEN 1 AND 5),
  ADD CONSTRAINT characters_pact_slots_range CHECK (pact_slots_current IS NULL OR pact_slots_max IS NULL OR pact_slots_current <= pact_slots_max);

INSERT INTO schema_migrations(version) VALUES (68);

COMMIT;
