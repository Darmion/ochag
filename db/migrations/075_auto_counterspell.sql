BEGIN;

ALTER TABLE characters DROP CONSTRAINT characters_auto_reactions_check;
ALTER TABLE characters
  ADD CONSTRAINT characters_auto_reactions_check CHECK (auto_reactions <@ ARRAY['shield', 'counterspell']::text[]);

INSERT INTO schema_migrations(version) VALUES (75);

COMMIT;
