BEGIN;

CREATE TABLE dialogues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  npc_id uuid,
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  nodes jsonb NOT NULL CHECK (jsonb_typeof(nodes) = 'array'),
  start_node text NOT NULL CHECK (length(start_node) BETWEEN 1 AND 40),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, npc_id) REFERENCES characters(campaign_id, id)
);

CREATE TABLE dialogue_sessions (
  campaign_id uuid PRIMARY KEY REFERENCES campaigns(id),
  dialogue_id uuid NOT NULL,
  node_id text NOT NULL,
  history jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(history) = 'array'),
  started_by uuid NOT NULL REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (campaign_id, dialogue_id) REFERENCES dialogues(campaign_id, id) ON DELETE CASCADE
);

GRANT SELECT, INSERT, UPDATE, DELETE ON dialogues, dialogue_sessions TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (55);

COMMIT;
