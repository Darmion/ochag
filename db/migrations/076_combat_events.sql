BEGIN;

CREATE TABLE combat_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  scene_id uuid NOT NULL,
  actor_id uuid,
  target_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('damage', 'heal')),
  amount integer NOT NULL CHECK (amount >= 0),
  dropped boolean NOT NULL DEFAULT false,
  source text NOT NULL CHECK (source IN ('trap', 'zone', 'hazard', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX combat_events_scene ON combat_events (campaign_id, scene_id, created_at);

GRANT SELECT, INSERT, DELETE ON combat_events TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (76);

COMMIT;
