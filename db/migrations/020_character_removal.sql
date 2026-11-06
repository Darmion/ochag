BEGIN;

GRANT DELETE ON characters, tokens, character_vision_overrides, import_drafts TO ttrpg_app;
GRANT UPDATE (character_id) ON roll_log TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (20);

COMMIT;
