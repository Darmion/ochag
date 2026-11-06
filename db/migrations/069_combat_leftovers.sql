BEGIN;

ALTER TABLE roll_applications
  ADD COLUMN mode text CHECK (mode IS NULL OR mode IN ('damage', 'heal')),
  ADD COLUMN applied integer CHECK (applied IS NULL OR applied >= 0),
  ADD COLUMN dropped boolean;

CREATE TABLE scene_opportunities (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  scene_id uuid NOT NULL,
  reactor_id uuid NOT NULL,
  mover_id uuid NOT NULL,
  reactor_name text NOT NULL,
  mover_name text NOT NULL,
  weapon_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scene_id, reactor_id, mover_id),
  FOREIGN KEY (campaign_id, scene_id) REFERENCES scenes(campaign_id, id),
  FOREIGN KEY (campaign_id, reactor_id) REFERENCES characters(campaign_id, id),
  FOREIGN KEY (campaign_id, mover_id) REFERENCES characters(campaign_id, id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON scene_opportunities TO ttrpg_app;
GRANT UPDATE (mode, applied, dropped) ON roll_applications TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (69);

COMMIT;
