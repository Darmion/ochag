BEGIN;

ALTER TABLE initiative_entries
  ADD COLUMN action_used boolean NOT NULL DEFAULT false,
  ADD COLUMN bonus_used boolean NOT NULL DEFAULT false,
  ADD COLUMN reaction_used boolean NOT NULL DEFAULT false,
  ADD COLUMN attacks_made integer NOT NULL DEFAULT 0 CHECK (attacks_made BETWEEN 0 AND 20),
  ADD COLUMN disengaged boolean NOT NULL DEFAULT false,
  ADD COLUMN leveled_action_spell boolean NOT NULL DEFAULT false,
  ADD COLUMN bonus_spell boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations(version) VALUES (48);

COMMIT;
