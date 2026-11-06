BEGIN;

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  user_id uuid NOT NULL REFERENCES users(id),
  character_id uuid,
  to_user_id uuid REFERENCES users(id),
  in_character boolean NOT NULL DEFAULT false,
  body text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, id),
  FOREIGN KEY (campaign_id, character_id) REFERENCES characters(campaign_id, id),
  CHECK (NOT in_character OR character_id IS NOT NULL)
);

CREATE INDEX chat_messages_campaign_time ON chat_messages(campaign_id, created_at DESC);

GRANT SELECT, INSERT, DELETE ON chat_messages TO ttrpg_app;

INSERT INTO schema_migrations(version) VALUES (56);

COMMIT;
