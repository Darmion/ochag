BEGIN;

CREATE TABLE campaign_quests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed')),
  xp_reward integer NOT NULL DEFAULT 0 CHECK (xp_reward BETWEEN 0 AND 1000000),
  hidden boolean NOT NULL DEFAULT false,
  rewarded_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id)
);

CREATE INDEX campaign_quests_campaign ON campaign_quests(campaign_id, created_at);

CREATE TABLE campaign_quest_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL,
  quest_id uuid NOT NULL,
  text text NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 300),
  done boolean NOT NULL DEFAULT false,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, quest_id) REFERENCES campaign_quests(campaign_id, id) ON DELETE CASCADE
);

CREATE INDEX campaign_quest_objectives_quest ON campaign_quest_objectives(campaign_id, quest_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE
  ON campaign_quests, campaign_quest_objectives
  TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (47);

COMMIT;
