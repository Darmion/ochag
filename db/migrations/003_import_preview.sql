BEGIN;

ALTER TABLE import_drafts
  ADD COLUMN draft_revision integer NOT NULL DEFAULT 1
    CHECK (draft_revision > 0),
  ADD COLUMN result_character_id uuid,
  ADD CONSTRAINT import_result_same_campaign
    FOREIGN KEY (campaign_id, result_character_id)
    REFERENCES characters(campaign_id, id);

GRANT SELECT, INSERT, UPDATE
  ON characters, import_drafts
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (3);

COMMIT;