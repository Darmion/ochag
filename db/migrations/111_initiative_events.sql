BEGIN;

ALTER TABLE characters ADD COLUMN turn_events jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(turn_events) = 'array');

ALTER TABLE initiative_entries ADD COLUMN event_of uuid;
ALTER TABLE initiative_entries ADD CONSTRAINT initiative_entries_event_owner FOREIGN KEY (campaign_id, event_of) REFERENCES characters(campaign_id, id) ON DELETE CASCADE;
ALTER TABLE initiative_entries ADD COLUMN event_kind text CHECK (event_kind IS NULL OR length(event_kind) BETWEEN 1 AND 32);
ALTER TABLE initiative_entries ADD COLUMN event_last text CHECK (event_last IS NULL OR length(event_last) <= 80);
ALTER TABLE initiative_entries ADD COLUMN tie_rank smallint NOT NULL DEFAULT 0 CHECK (tie_rank BETWEEN -1 AND 1);
ALTER TABLE initiative_entries ADD CONSTRAINT initiative_entries_event_pair CHECK ((event_of IS NULL) = (event_kind IS NULL));
CREATE UNIQUE INDEX initiative_entries_event ON initiative_entries(campaign_id, scene_id, event_of, event_kind) WHERE event_of IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES (111);

COMMIT;
