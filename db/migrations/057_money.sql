BEGIN;

ALTER TABLE characters
  ADD COLUMN cp integer NOT NULL DEFAULT 0 CHECK (cp >= 0),
  ADD COLUMN sp integer NOT NULL DEFAULT 0 CHECK (sp >= 0),
  ADD COLUMN ep integer NOT NULL DEFAULT 0 CHECK (ep >= 0),
  ADD COLUMN gp integer NOT NULL DEFAULT 0 CHECK (gp >= 0),
  ADD COLUMN pp integer NOT NULL DEFAULT 0 CHECK (pp >= 0),
  ADD COLUMN price_cp integer CHECK (price_cp IS NULL OR price_cp BETWEEN 0 AND 100000000),
  ADD COLUMN weight_lb numeric CHECK (weight_lb IS NULL OR (weight_lb >= 0 AND weight_lb <= 100000)),
  ADD COLUMN merchant boolean NOT NULL DEFAULT false;

CREATE FUNCTION coins_from_extra(extra jsonb, coin text) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
  SELECT LEAST(1000000000, GREATEST(0, COALESCE(
    CASE jsonb_typeof(extra->'coins'->coin)
      WHEN 'number' THEN trunc((extra->'coins'->>coin)::numeric)
      WHEN 'string' THEN CASE WHEN (extra->'coins'->>coin) ~ '^[0-9]{1,9}$' THEN (extra->'coins'->>coin)::numeric END
      WHEN 'object' THEN CASE jsonb_typeof(extra->'coins'->coin->'value')
        WHEN 'number' THEN trunc((extra->'coins'->coin->>'value')::numeric)
        WHEN 'string' THEN CASE WHEN (extra->'coins'->coin->>'value') ~ '^[0-9]{1,9}$' THEN (extra->'coins'->coin->>'value')::numeric END
      END
    END, 0)))::integer
$$;

UPDATE characters SET
  cp = coins_from_extra(sheet_extra, 'cp'),
  sp = coins_from_extra(sheet_extra, 'sp'),
  ep = coins_from_extra(sheet_extra, 'ep'),
  gp = coins_from_extra(sheet_extra, 'gp'),
  pp = coins_from_extra(sheet_extra, 'pp')
WHERE jsonb_typeof(sheet_extra->'coins') = 'object';

INSERT INTO schema_migrations(version) VALUES (57);

COMMIT;
