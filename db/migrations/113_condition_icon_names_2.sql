BEGIN;

UPDATE campaign_conditions SET icon='charmed' WHERE code='charmed' AND icon='heart';
UPDATE campaign_conditions SET icon='frightened' WHERE code='frightened' AND icon='alert';
UPDATE campaign_conditions SET icon='paralyzed' WHERE code='paralyzed' AND icon='bolt';

INSERT INTO schema_migrations(version) VALUES (113);

COMMIT;
