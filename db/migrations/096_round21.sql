ALTER TABLE initiative_entries ADD COLUMN reflex_of uuid;

INSERT INTO schema_migrations(version) VALUES (96);
