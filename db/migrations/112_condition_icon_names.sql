BEGIN;

UPDATE campaign_conditions SET icon='invisible' WHERE code='invisible' AND icon='ghost';
UPDATE campaign_conditions SET icon='stunned' WHERE code='stunned' AND icon='spiral';
UPDATE campaign_conditions SET icon='unconscious' WHERE code='unconscious' AND icon='moon';

INSERT INTO schema_migrations(version) VALUES (112);

COMMIT;
