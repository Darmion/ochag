BEGIN;

ALTER TABLE characters
  ADD COLUMN auto_reactions text[] NOT NULL DEFAULT '{}'
    CHECK (auto_reactions <@ ARRAY['shield']::text[]);

INSERT INTO schema_migrations(version) VALUES (72);

COMMIT;
