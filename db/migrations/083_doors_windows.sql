BEGIN;

ALTER TABLE scene_walls
  ADD COLUMN kind text NOT NULL DEFAULT 'wall' CHECK (kind IN ('wall', 'door', 'window')),
  ADD COLUMN open boolean NOT NULL DEFAULT false,
  ADD COLUMN locked boolean NOT NULL DEFAULT false,
  ADD COLUMN hp integer CHECK (hp BETWEEN 0 AND 10000),
  ADD COLUMN hp_max integer CHECK (hp_max BETWEEN 1 AND 10000),
  ADD COLUMN broken boolean NOT NULL DEFAULT false,
  ADD CHECK (kind = 'door' OR (NOT open AND NOT locked));

INSERT INTO schema_migrations(version) VALUES (83);

COMMIT;
