BEGIN;

CREATE TABLE campaign_minigames (
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  kind text NOT NULL CHECK (kind IN ('dragon-dice', 'rune-lock', 'seal-ritual', 'alchemy', 'chase', 'duel', 'map-fragments')),
  state jsonb CHECK (state IS NULL OR jsonb_typeof(state) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, kind)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_minigames TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (108);

COMMIT;
