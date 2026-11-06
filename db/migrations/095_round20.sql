ALTER TABLE scene_triggers ADD COLUMN fall_feet integer CHECK (fall_feet BETWEEN 1 AND 1000);

ALTER TABLE characters DROP CONSTRAINT characters_auto_reactions_check;
ALTER TABLE characters
  ADD CONSTRAINT characters_auto_reactions_check
  CHECK (auto_reactions <@ ARRAY['shield', 'counterspell', 'hellish-rebuke', 'protection', 'deflect-missiles', 'uncanny-dodge', 'parry', 'riposte', 'cutting-words', 'lucky', 'retaliation']::text[]);

INSERT INTO schema_migrations(version) VALUES (95);
