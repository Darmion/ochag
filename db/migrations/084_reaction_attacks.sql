BEGIN;

ALTER TABLE scene_opportunities
  ADD COLUMN reason text NOT NULL DEFAULT 'leave' CHECK (reason IN ('leave', 'sentinel', 'mage-slayer'));

ALTER TABLE characters DROP CONSTRAINT characters_auto_reactions_check;
ALTER TABLE characters
  ADD CONSTRAINT characters_auto_reactions_check
  CHECK (auto_reactions <@ ARRAY['shield', 'counterspell', 'hellish-rebuke', 'protection', 'deflect-missiles', 'uncanny-dodge', 'parry', 'riposte', 'cutting-words', 'lucky']::text[]);

INSERT INTO schema_migrations(version) VALUES (84);

COMMIT;
