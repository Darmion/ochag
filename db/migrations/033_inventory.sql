BEGIN;

ALTER TABLE characters
  ADD COLUMN container_id uuid,
  ADD CONSTRAINT characters_container
    FOREIGN KEY (campaign_id, container_id) REFERENCES characters(campaign_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT characters_container_not_self
    CHECK (container_id IS NULL OR container_id <> id),
  ADD CONSTRAINT characters_container_only_objects
    CHECK (container_id IS NULL OR kind = 'object');

CREATE INDEX characters_container ON characters(campaign_id, container_id)
  WHERE container_id IS NOT NULL;

INSERT INTO schema_migrations(version) VALUES (33);

COMMIT;
