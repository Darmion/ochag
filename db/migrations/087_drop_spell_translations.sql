BEGIN;

DROP TABLE srd_spell_translations;

INSERT INTO schema_migrations(version) VALUES (87);

COMMIT;
