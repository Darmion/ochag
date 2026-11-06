BEGIN;

ALTER TABLE characters
  ADD COLUMN experience integer NOT NULL DEFAULT 0 CHECK (experience BETWEEN 0 AND 10000000),
  ADD COLUMN challenge_rating numeric(6,3) CHECK (
    challenge_rating IN (0, 0.125, 0.25, 0.5) OR (challenge_rating BETWEEN 1 AND 30 AND challenge_rating = trunc(challenge_rating))
  ),
  ADD COLUMN xp_award integer CHECK (xp_award BETWEEN 0 AND 1000000),
  ADD COLUMN xp_awarded boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations(version) VALUES (45);

COMMIT;
